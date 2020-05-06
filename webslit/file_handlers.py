import os
import logging
import yaml
import json
import random
from base64 import b64decode

from datetime import datetime
from functools import partial, wraps

from tornado.options import options
from tornado.concurrent import run_on_executor
from tornado.gen import coroutine
from tornado.locks import Event
from tornado.util import TimeoutError
import tornado.web

from plumbum import local
from easypy.bunch import Bunch
from easypy.timing import Timer
from easypy.units import MINUTE

from .utils import to_data_size
from .worker import Worker, CLIENTS, recycle_worker


WEB_SOCKET_EXPIRATION = 10  # how long before we recycle the worker if no one connected


load_yaml = partial(yaml.load, Loader=yaml.SafeLoader)


class Argv(tuple):
    def __new__(cls, *args, **kwargs):
        self = super().__new__(cls, *args)
        self.env = kwargs
        return self


class BaseHandler():

    name = None
    static = False
    power_only = False
    follow = False

    def __init__(self, fullpath, handler):
        self.fullpath = fullpath
        self.handler = handler

    @property
    def files(self):
        return [self.fullpath]

    def __repr__(self):
        return f"{self.__class__.__name__}({self.fullpath})"

    @classmethod
    def applies_to(cls, fullpath, handler):
        return False

    def get_cmd(self):
        raise NotImplementedError

    def get_argv(self):
        cmd = self.get_cmd()
        follow = "--follow" if self.follow else ""
        return Argv([
            "bash", "-o", "pipefail", "-ce",
            f"(({cmd}) 2>/dev/null || echo 'failure reading {self.fullpath}')"
            f" | slit {follow} --always-term || (echo 'press <enter> to close'; read)"])

    def get_result(self, cwd):
        ip, port = self.handler.get_client_addr()
        workers = CLIENTS.setdefault(ip, {})
        if workers and len(workers) >= options.maxconn:
            raise tornado.web.HTTPError(403, 'Too many live connections.')

        argv = self.get_argv()

        try:
            worker = Worker(cwd, argv, self.handler.loop, self.files)
        except (ValueError) as exc:
            logging.exception("Error creating worker")
            return dict(error=True, status=str(exc))
        else:
            logging.info(f"{ip} -> {worker.id} ({self})")
            worker.src_addr = (ip, port)
            workers[worker.id] = worker
            self.handler.loop.call_later(WEB_SOCKET_EXPIRATION, recycle_worker, worker)
            return dict(worker_id=worker.id, encoding=worker.encoding)

    def __add__(self, fhandler):
        return ZipLogHandler([self, fhandler], self.handler)

    @classmethod
    def generate_entries(cls, *args, **kwargs):
        yield from []


class ZipLogHandler(BaseHandler):

    def __init__(self, fhandlers, handler):
        self.fhandlers = fhandlers
        self.handler = handler

    @property
    def files(self):
        return [fh.fullpath for fh in self.fhandlers]

    def get_argv(self):
        listing = " ".join(
            f"echo '{p:02X}> {fh.fullpath}';"
            for p, fh in enumerate(self.fhandlers))
        inputs = " ".join(
            f"'{p:02X}> '=<(({fh.get_cmd()}) 2>&1)"
            for p, fh in enumerate(self.fhandlers))
        script = f"({listing} echo; (RUST_BACKTRACE=full ziplog -f {inputs}) 2>&1) | slit --always-term"
        logging.info(script)
        return Argv(["bash", "-o", "pipefail", "-ce", script])

    def __repr__(self):
        description = " + ".join(self.files)
        return f"{self.__class__.__name__}: {description}"

    def __add__(self, fhandler):
        return ZipLogHandler(self.fhandlers + [fhandler], self.handler)


class FileHandler(BaseHandler):

    zippable = True

    @classmethod
    def applies_to(cls, fullpath, handler):
        return fullpath.is_file()

    def get_cmd(self):
        cmd = "gzip -dc" if self.fullpath.suffix == ".gz" else "cat"
        return f"{cmd} {self.fullpath}; echo"


class BashHandler(FileHandler):

    name = "bash"
    symbol = "__bash__"
    zippable = False
    power_only = True

    @classmethod
    def applies_to(cls, fullpath, handler):
        return fullpath.name == cls.symbol

    def get_argv(self):
        return Argv(["bash"], **os.environ)

    @classmethod
    def generate_entries(self, fullpath, handler, meta):
        if handler.is_power_user:
            yield dict(name=self.symbol, info="Open a shell within this WebSlit app server")


class DockerHandler(FileHandler):

    name = "docker"
    symbol = "__docker__"
    zippable = False
    power_only = True

    @classmethod
    def applies_to(cls, fullpath, handler):
        return cls.symbol in {fullpath.parent.name, fullpath.name}

    @classmethod
    def generate_entries(cls, fullpath, handler, meta):
        if fullpath == handler.root:
            yield dict(name=cls.symbol, is_dir=True, info="Attach to running docker containers")

    def get_result(self, cwd):
        if self.fullpath.parent.name == self.symbol:
            return super().get_result(self.handler.root)
        else:
            return dict(entries=list(self._get_entries()), meta={})

    def _get_entries(self):
        spec = "{{.ID}};{{.Names}};{{.Image}};{{.RunningFor}};{{.CreatedAt}}"
        for out, err in local.cmd.docker["ps", "--format", spec].popen():
            if out:
                cid, name, image, age, created = out.split(";")
                created = datetime.strptime(created.rsplit(maxsplit=1)[0], "%Y-%m-%d %H:%M:%S %z").timestamp()
                image = image.rsplit(":", 1)[-1]
                fullpath = self.fullpath[cid]
                yield Bunch(
                    name=name,
                    badges=[image],
                    info=age,
                    flags="m",
                    priority=(-created),
                    base=self.fullpath.relative_to(self.handler.root).parts,
                    path=f"/{fullpath.relative_to(self.handler.root)}",
                )

    def get_argv(self):
        cid = self.fullpath.name.partition(" ")[0]
        return Argv(["docker", "attach", cid])


class StaticFileHandler(FileHandler):

    TYPES = []
    zippable = False
    static = True

    @classmethod
    def applies_to(cls, fullpath, handler):
        return fullpath.endswith(f".{cls.name}")

    @classmethod
    def register(cls, types):
        for typ in types:
            subcls = type(typ.title() + "Handler", (cls,), dict(name=typ))
            HANDLERS.insert(0, subcls)
            cls.TYPES.append(subcls)


class TcpDumpFileHandler(FileHandler):

    name = "tcpdump"
    tcpdump_suffixes = {"pcap", "tcpdump"}

    @classmethod
    def applies_to(cls, fullpath, handler):
        for sfx in fullpath.suffixes:
            if sfx in cls.tcpdump_suffixes:
                return True
        return False

    def __init__(self, fullpath, handler):
        super().__init__(fullpath, handler)
        self.use_termshark = self.handler.get_cookie("termshark", "") == "yes"

    def get_argv(self):
        if not self.use_termshark:
            return super().get_argv()

        # env = dict(PATH=os.getenv("PATH"))
        env = os.environ.copy()
        if self.fullpath.suffix == ".zst":
            return Argv([
                "bash", "-o", "pipefail", "-ce",
                f"""
                NAME=$(mktemp)
                zstdcat {self.fullpath} -o $NAME
                termshark -ta $NAME
                rm -fv $NAME
                """], **env)
        else:
            return Argv(["termshark", "-ta", self.fullpath], **env)

    def get_cmd(self):
        if self.fullpath.suffix == ".zst":
            return f"zstdcat {self.fullpath} | tcpdump -tttt -r -"
        else:
            return f"tcpdump -tttt -r {self.fullpath}"


class PathInfo(Bunch):
    def __init__(
            self, name, fullbase, is_dir=False, is_symlink=False, unreachable=False, priority=1000,
            *, handler, fh=None, path=None, is_magic=False, info='', power_only=False):
        self.flags = ""
        if is_dir:
            self.flags += "d"
        if is_symlink:
            self.flags += "y"
        if unreachable:
            self.flags += "u"
        if is_magic:
            self.flags += "m"
        if path:
            self.path = path

        fullpath = fullbase[name]
        self.priority = priority
        self.name = name
        self.base = fullbase.relative_to(handler.root).parts
        self.info = info
        self.badges = []
        if power_only:
            self.power_only = True
        if not fh:
            fh = get_handler(fullpath, handler)
        if fh:
            if fh.name:
                self.badges.append(fh.name)
            if fh.zippable:
                self.flags += "z"
            if fh.static:
                self.flags += "s"

    @property
    def is_dir(self):
        return "d" in self.flags

    @property
    def is_unreachable(self):
        return "u" in self.flags

    @property
    def is_symlink(self):
        return "y" in self.flags

    def fetch_info(self, fh):
        if self.info:
            return
        fullpath = fh.root.join(*self.base)[self.name]
        max_items = fh.max_items
        try:
            try:
                if self.is_dir:
                    i = "No"
                    for i, _ in enumerate(os.scandir(fullpath), 1):
                        if i > max_items:
                            i = f"Over {max_items}"
                            break
                    self.info = f"{i} entries"
                else:
                    self.info = to_data_size(fullpath.stat().st_size) or "?"
                    self.flags += "l"
            except FileNotFoundError as exc:
                if self.is_symlink:
                    self.info = f" ⇏ {os.readlink(str(fullpath))}"
                else:
                    self.info = str(exc)
                if not self.is_unreachable:
                    self.flags += 'u'
        except Exception as exc:
            logging.exception(f"Error fetching info on {self.path}")
            if not self.is_unreachable:
                self.flags += 'u'
            self.info = str(exc)

        # fh.set_done()  # not running asynchronously


class PagingHandlerMixin():

    expiration = 30
    keepalive_timeout = 10

    class Aborted(Exception):
        pass

    @classmethod
    def fetcher(cls, func):
        @run_on_executor(executor="executor")
        @wraps(func)
        def inner(self, *args, **kwargs):
            expiration = self.expiration
            try:
                return func(self, *args, **kwargs)
            except cls.Aborted:
                self.set_done(0)
            except Exception as exc:
                logging.exception(f"Exception from {func}")
                self.error = str(exc)
                self.set_done(expiration * 2)
        return inner

    def __init__(self, fullpath, handler):
        self.executor = handler.executor
        self.entries = []
        self.meta = {}
        self.error = False
        self._heartbeat = Timer(expiration=self.keepalive_timeout)
        self._timeout = None
        self._incomplete = True
        self._event = Event()
        super().__init__(fullpath, handler)

    @property
    def is_expired(self):
        return self._timeout and self._timeout.expired

    @classmethod
    def scrub_lru(cls):
        scrubbed = 0
        for i in range(len(cls.lru)):
            k = cls.lru.pop(0)
            item = cls.pending.get(k)
            if not item:
                pass
            elif not item.is_expired:
                cls.lru.append(k)
            else:
                logging.debug(f"scrubbed {k}: {item}")
                scrubbed += 1
                del cls.pending[k]
        if scrubbed:
            logging.info(f"scrubbed {scrubbed}/{len(cls.lru)} from lru cache on {cls}")

    @coroutine
    def get_result(self, cwd):
        handler = self.pending.get(self.fullpath)
        offset = int(self.handler.get_argument("offset", "0"))
        reset = False
        if handler and not handler.is_expired:
            logging.info(f"found {handler} with {handler._timeout.remain if handler._timeout else 'incomplete'}")
        else:
            reset = offset != 0  # the client must reset its list
            logging.info(f"starting to fetch for {self}")
            self.start_fetching()
            self.pending[self.fullpath] = handler = self
            self.lru.append(self.fullpath)
            self.scrub_lru()
            try:
                yield self._event.wait(0.5)
            except TimeoutError:
                pass

        handler._heartbeat.reset()

        return dict(
            entries=handler.entries[offset:],
            meta=handler.meta,
            incomplete=handler._incomplete,
            reset=reset,
            error=handler.error,
        )

    def check_abort(self):
        if self._heartbeat.expired:
            logging.info(f"no heartbeats - aborting fetching on {self}")
            self._timeout = Timer(expiration=0)
            self._event.set()
            raise self.Aborted()

    def set_done(self, expiration=None):
        self._incomplete = False
        self._event.set()
        self._timeout = Timer(expiration=self.expiration if expiration is None else expiration)


class DirectoryHandler(PagingHandlerMixin, BaseHandler):

    zippable = False
    name = None
    pending = {}
    lru = []
    expiration = MINUTE
    keepalive_timeout = MINUTE

    def __init__(self, fullpath, handler, parent_override=None):
        super().__init__(fullpath, handler)
        self.PathInfo = partial(PathInfo, handler=handler)
        self.max_items = int(handler.get_cookie("max_items", "1000"))
        self.root = handler.root
        self.parent = (
            parent_override if parent_override else
            None if fullpath == self.root else
            fullpath.parent if fullpath.parents else
            None)
        self._tasks = 1
        self.mtime = fullpath.stat().st_mtime

    @property
    def is_expired(self):
        return super().is_expired or self.mtime < self.fullpath.stat().st_mtime

    def start_fetching(self):
        self._fetch_entries()

    @classmethod
    def applies_to(cls, fullpath, handler):
        return fullpath.is_dir()

    @PagingHandlerMixin.fetcher
    def _fetch_entries(self):
        self._fetch_meta()
        fullpath = self.fullpath
        entries = self.entries
        if self.parent:
            path = f"/{self.parent.relative_to(self.root)}"
            up = self.PathInfo("..", self.parent, path=path, is_dir=True, priority=0)
            entries.append(up)

        for priority, fh in enumerate(HANDLERS, 1):
            for d in fh.generate_entries(self.fullpath, self.handler, self.meta):
                d.setdefault('is_magic', True)
                if fh.power_only:
                    d.update(power_only=True)
                entries.append(self.PathInfo(fullbase=fullpath, fh=fh, priority=priority, **d))

        for n, d in enumerate(os.scandir(fullpath), 1):
            if n % 500 == 0:
                logging.info(f"{fullpath}: {n:4} items... ({d.path})")

            if n == 18 and random.random() > 0.9:
                entries.append(self.PathInfo("classified.txt", fullpath, False, False))

            is_dir = d.is_dir(follow_symlinks=True)
            entry = self.PathInfo(d.name, fullpath, is_dir, d.is_symlink())
            entry.fetch_info(self)
            # self._tasks += 1
            # self.executor.submit(entry.fetch_info, self)
            entries.append(entry)
            self.check_abort()

        self.set_done()

    def _fetch_meta(self):
        fullpath = self.fullpath
        meta = {}
        while fullpath != self.root:
            try:
                with fullpath['.meteorite'].open() as f:
                    for parser in (load_yaml, json.load):
                        try:
                            meta = parser(f)
                            break
                        except Exception:
                            pass
                    else:
                        logging.error(f"Could not parse {fullpath}/.meteorite")
                        meta = dict(error=f'(could not parse {fullpath}.meteorite)')
            except FileNotFoundError:
                pass
            fullpath = fullpath.parent
        self.meta.update(meta)

    def set_done(self):
        self._tasks -= 1
        if not self._tasks:
            super().set_done()


class GolHandler(BaseHandler):

    zippable = False

    @classmethod
    def applies_to(cls, fullpath, handler):
        return fullpath.name == b64decode(b'Y2xhc3NpZmllZC50eHQ=').decode()

    def get_argv(self):
        from sentry_sdk import capture_message
        capture_message(f"classified opened")
        return Argv(["bash", "-ce", "python3.7 /webslit/static/js/gol.js"], **os.environ)


HANDLERS = [
    GolHandler,
    DirectoryHandler,
    TcpDumpFileHandler,
    FileHandler,
    BashHandler,
    DockerHandler,
]


def get_handler(fullpath, handler):
    for fh in HANDLERS:
        if fh.power_only and not handler.is_power_user:
            continue
        if fh.applies_to(fullpath, handler):
            return fh(fullpath, handler)
