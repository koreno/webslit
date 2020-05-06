import json
import logging
import struct
from datetime import datetime
import weakref
import tornado.web

from plumbum import local
from easypy.bunch import Bunch

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from tornado.ioloop import IOLoop
from tornado.options import options
from tornado.process import cpu_count
from tornado.gen import coroutine
from tornado.httpclient import AsyncHTTPClient
from webslit.utils import (is_valid_port, to_int, UnicodeType, is_same_primary_domain)
from webslit.worker import CLIENTS
from webslit.file_handlers import StaticFileHandler, get_handler
from . import MAJOR, MINOR, COMMIT, __version__

try:
    from json.decoder import JSONDecodeError
except ImportError:
    JSONDecodeError = ValueError

try:
    from urllib.parse import urlparse
except ImportError:
    from urlparse import urlparse


DEFAULT_PORT = 22

swallow_http_errors = True
redirecting = None


class InvalidValueError(Exception):
    pass


class MixinHandler(object):

    custom_headers = {
        'Server': 'TornadoServer'
    }

    html = ('<html><head><title>{code} {reason}</title></head><body>{code} '
            '{reason}</body></html>')

    def initialize(self, loop=None):
        self.check_request()
        self.loop = loop
        self.origin_policy = self.settings.get('origin_policy')

    def check_request(self):
        context = self.request.connection.context
        result = self.is_forbidden(context, self.request.host_name)
        self._transforms = []
        if result:
            self.set_status(403)
            self.finish(
                self.html.format(code=self._status_code, reason=self._reason)
            )
        elif result is False:
            to_url = self.get_redirect_url(
                self.request.host_name, options.sslport, self.request.uri
            )
            self.redirect(to_url, permanent=True)
        else:
            self.context = context

    def check_origin(self, origin):
        if self.origin_policy == '*':
            return True

        parsed_origin = urlparse(origin)
        netloc = parsed_origin.netloc.lower()
        logging.debug(f'netloc: {netloc}')

        host = self.request.headers.get('Host')
        logging.debug(f'host: {host}')

        if netloc == host:
            return True

        if self.origin_policy == 'same':
            return False
        elif self.origin_policy == 'primary':
            return is_same_primary_domain(netloc.rsplit(':', 1)[0],
                                          host.rsplit(':', 1)[0])
        else:
            return origin in self.origin_policy

    def is_forbidden(self, context, hostname):
        pass

    def get_redirect_url(self, hostname, port, uri):
        port = '' if port == 443 else f':{port}'
        return f'https://{hostname}{port}{uri}'

    def set_default_headers(self):
        for header in self.custom_headers.items():
            self.set_header(*header)

    def get_value(self, name):
        value = self.get_argument(name)
        if not value:
            raise InvalidValueError(f'Missing value {name}')
        return value

    def get_context_addr(self):
        return self.context.address[:2]

    def get_client_addr(self):
        if options.xheaders:
            return self.get_real_client_addr() or self.get_context_addr()
        else:
            return self.get_context_addr()

    def get_real_client_addr(self):
        ip = self.request.remote_ip

        if ip == self.request.headers.get('X-Real-Ip'):
            port = self.request.headers.get('X-Real-Port')
        elif ip in self.request.headers.get('X-Forwarded-For', ''):
            port = self.request.headers.get('X-Forwarded-Port')
        else:
            # not running behind an nginx server
            return

        port = to_int(port)
        if port is None or not is_valid_port(port):
            # fake port
            port = 65535

        return (ip, port)


class NotFoundHandler(MixinHandler, tornado.web.ErrorHandler):

    def initialize(self):
        super(NotFoundHandler, self).initialize()

    def prepare(self):
        raise tornado.web.HTTPError(404)


class ChecksOrigin:

    def check_origin(self):
        event_origin = self.get_argument('_origin', u'')
        header_origin = self.request.headers.get('Origin')
        origin = event_origin or header_origin

        if origin:
            if not super().check_origin(origin):
                raise tornado.web.HTTPError(
                    403, 'Cross origin operation is not allowed.'
                )

            if not event_origin and self.origin_policy != 'same':
                self.set_header('Access-Control-Allow-Origin', origin)


class VueHandler(ChecksOrigin, MixinHandler, tornado.web.RequestHandler):

    executor = ThreadPoolExecutor(max_workers=cpu_count() * 5)

    def initialize(self, loop, root):
        super().initialize(loop)
        self.root = local.path(root)
        self.methods = dict(active_sessions=self.get_active_sessions, entry=self.get_entry, ziplog=self.get_entry)
        self.is_power_user = self.get_cookie("power") == "yes"
        self.is_debug = self.get_cookie("debug") == "yes"
        if self.is_debug:
            breakpoint()

    @coroutine
    def get(self, view):
        method = self.methods.get(view)
        if not method:
            self.write(f"No such method: {view}")
            self.finish()
        else:
            ret = yield tornado.gen.maybe_future(method())
            self.finish(ret)

    post = get

    def get_active_sessions(self):
        now = datetime.now()
        return dict(sessions=sorted((dict(
            age=int((now - w.last_heartbeat).total_seconds()),
            ip=w.client_ip,
            path=str(w.files[0].relative_to(self.root)),
            n_files=len(w.files))
            for w in WsockHandler.ACTIVE),
            key=lambda d: d['age']))

    @coroutine
    def get_entry(self):
        path = self.get_argument("path", "/")
        fullpath = self.root[path.strip("/")]

        result = Bunch(
            root=str(self.root),
            error=False,
            meta=defaultdict(str),
            worker_id=None,
            redirect=None,
            encoding=None,
            entries=[],
            breadcrumbs=[],
            breadcrumbs_tail=None,
            path=path,
            has_power=self.is_power_user,
        )

        breadcrumbs = []
        c = fullpath.relative_to(self.root)
        while c:
            breadcrumbs.append(dict(part=c[-1], path=f"/{c}"))
            c = c.up()
        breadcrumbs.append(dict(part=self.root, path="/"))
        breadcrumbs.reverse()
        *result.breadcrumbs, result.breadcrumbs_tail = breadcrumbs

        files = [self.root[fp.strip("/")] for fp in self.get_arguments("files[]")]
        if files:
            cwd = fullpath
        else:
            cwd = fullpath.parent
            files = [fullpath]

        fh = None
        try:
            for fullpath in files:
                fh2 = get_handler(fullpath, self)
                logging.info(fh2)
                if not fh2:
                    parts = path.strip("/").split("/")
                    if parts[0] == self.root.name:
                        result.redirect = f"/{'/'.join(parts[1:])}"
                    else:
                        result.error = f"Invalid path: {fullpath}"
                    fh = None
                    break
                elif not fh:
                    fh = fh2
                elif not fh2.zippable:
                    raise ValueError(f"Cannot zip with: {fullpath}")
                else:
                    fh = fh + fh2
        except ValueError as e:
            logging.exception(f"Error getting handler for {files}")
            result.error = str(e)
        else:
            if not fh:
                pass
            elif fh.static:
                result.redirect = f"/{fh.fullpath.relative_to(self.root)}"
            else:
                ret = yield tornado.gen.maybe_future(fh.get_result(cwd=cwd))
                result.update(ret)

        return result.to_dict()


class IndexHandler(ChecksOrigin, MixinHandler, tornado.web.RequestHandler):

    def initialize(self, loop):
        super().initialize(loop)
        assert self.xsrf_token  # force a cookie to be set
        self.debug = self.settings.get('debug', False)
        self.result = dict(id=None, status=None, encoding=None)

    def write_error(self, status_code, **kwargs):
        if swallow_http_errors and self.request.method == 'POST':
            exc_info = kwargs.get('exc_info')
            if exc_info:
                reason = getattr(exc_info[1], 'log_message', None)
                if reason:
                    self._reason = reason
            self.result.update(status=self._reason)
            self.set_status(200)
            self.finish(self.result)
        else:
            super(IndexHandler, self).write_error(status_code, **kwargs)

    def head(self, path=None):
        pass

    @coroutine
    def get(self, path=None):
        if path:
            return self.redirect(f"/#{path}")
        host, _, port = self.request.host.partition(":")
        if not port:
            port = "80"

        thishost = f"{host}:{port}"

        logging.info(f"request for {thishost}")

        preference = self.get_cookie("preferred_port", port)
        if not preference:
            preference = "80"

        if port != preference:
            logging.info("%r, %r -> %r", host, port, preference)
            url = f"http://{host}:{preference}/"
            try:
                resp = yield AsyncHTTPClient().fetch(url)
                resp.rethrow()
            except Exception:
                logging.exception(f"Failed to reach {url}")
            else:
                return self.redirect(url)

        vue_mode = self.get_cookie("vue", "dev")
        return super().render(
            'index.html', debug=self.debug,
            vue_mode=vue_mode, sentry_url=options.sentry_url,
            static_files=[t.name for t in StaticFileHandler.TYPES],
            special_files="pcap tcpdump iolog".split(),
            thishost=thishost, environment=options.sentry_environment,
            release=__version__, major=MAJOR, minor=MINOR, commit=COMMIT,
        )


class WsockHandler(MixinHandler, tornado.websocket.WebSocketHandler):

    ACTIVE = set()

    def initialize(self, loop):
        super(WsockHandler, self).initialize(loop)
        self.worker_ref = None

    def open(self):
        self.src_addr = self.client_ip, _ = self.get_client_addr()
        logging.info('Connected from {}:{}'.format(*self.src_addr))
        workers = CLIENTS.get(self.client_ip)
        if not workers:
            self.close(reason='Websocket authentication failed.')
            return

        try:
            worker_id = self.get_value('id')
        except (tornado.web.MissingArgumentError, InvalidValueError) as exc:
            self.close(reason=str(exc))
        else:
            worker = workers.get(worker_id)
            if worker:
                workers[worker_id] = None
                self.set_nodelay(True)
                worker.set_handler(self)
                self.worker_ref = weakref.ref(worker)
                self.loop.add_handler(worker.fd, worker, IOLoop.READ)

                self.created = self.last_heartbeat = datetime.now()
                self.files = worker.files
                self.ACTIVE.add(self)
            else:
                self.close(reason='Websocket authentication failed.')

    def on_message(self, message):
        logging.debug(f'{len(message)} from {self.src_addr}')
        try:
            msg = json.loads(message)
        except JSONDecodeError:
            return

        if not isinstance(msg, dict):
            return

        self.last_heartbeat = datetime.now()
        worker = self.worker_ref()
        if not worker:
            return

        resize = msg.get('resize')
        if resize and len(resize) == 2:
            try:
                worker.resize(*resize)
            except (TypeError, struct.error):
                logging.exception(f"error setting size: {resize}")
                pass

        data = msg.get('data')
        if data and isinstance(data, UnicodeType):
            worker.data_to_dst.append(data)
            worker.on_write()

    def on_close(self):
        logging.info('Disconnected from {}:{}'.format(*self.src_addr))

        self.ACTIVE.discard(self)

        if not self.close_reason:
            self.close_reason = 'client disconnected'

        worker = self.worker_ref() if self.worker_ref else None
        if worker:
            worker.close(reason=self.close_reason)
