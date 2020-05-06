import os
import fcntl
import locale
import ipaddress
import re
import logging
from threading import Event

try:
    from types import UnicodeType
except ImportError:
    UnicodeType = str

try:
    from urllib.parse import urlparse
except ImportError:
    from urlparse import urlparse


numeric = re.compile(r'[0-9]+$')
allowed = re.compile(r'(?!-)[a-z0-9-]{1,63}(?<!-)$', re.IGNORECASE)


def to_str(bstr, encoding='utf-8'):
    if isinstance(bstr, bytes):
        return bstr.decode(encoding)
    return bstr


def to_bytes(ustr, encoding='utf-8'):
    if isinstance(ustr, UnicodeType):
        return ustr.encode(encoding)
    return ustr


def to_int(string):
    try:
        return int(string)
    except (TypeError, ValueError):
        pass


def to_ip_address(ipstr):
    ip = to_str(ipstr)
    if ip.startswith('fe80::'):
        ip = ip.split('%')[0]
    return ipaddress.ip_address(ip)


def is_valid_ip_address(ipstr):
    try:
        to_ip_address(ipstr)
    except ValueError:
        return False
    return True


def is_valid_port(port):
    return 0 < port < 65536


def is_valid_encoding(encoding):
    try:
        u'test'.encode(encoding)
    except LookupError:
        return False
    return True


def is_ip_hostname(hostname):
    it = iter(hostname)
    if next(it) == '[':
        return True
    for ch in it:
        if ch != '.' and not ch.isdigit():
            return False
    return True


def is_valid_hostname(hostname):
    if hostname[-1] == '.':
        # strip exactly one dot from the right, if present
        hostname = hostname[:-1]
    if len(hostname) > 253:
        return False

    labels = hostname.split('.')

    # the TLD must be not all-numeric
    if numeric.match(labels[-1]):
        return False

    return all(allowed.match(label) for label in labels)


def is_same_primary_domain(domain1, domain2):
    i = -1
    dots = 0
    l1 = len(domain1)
    l2 = len(domain2)
    m = min(l1, l2)

    while i >= -m:
        c1 = domain1[i]
        c2 = domain2[i]

        if c1 == c2:
            if c1 == '.':
                dots += 1
                if dots == 2:
                    return True
        else:
            return False

        i -= 1

    if l1 == l2:
        return True

    if dots == 0:
        return False

    c = domain1[i] if l1 > m else domain2[i]
    return c == '.'


def parse_origin_from_url(url):
    url = url.strip()
    if not url:
        return

    if not (url.startswith('http://') or url.startswith('https://') or
            url.startswith('//')):
        url = '//' + url

    parsed = urlparse(url)
    port = parsed.port
    scheme = parsed.scheme

    if scheme == '':
        scheme = 'https' if port == 443 else 'http'

    if port == 443 and scheme == 'https':
        netloc = parsed.netloc.replace(':443', '')
    elif port == 80 and scheme == 'http':
        netloc = parsed.netloc.replace(':80', '')
    else:
        netloc = parsed.netloc

    return f'{scheme}://{netloc}'


UNIT_NAMES = {unit_name: 1024 ** i for i, unit_name in enumerate(['byte', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'XiB'])}
SORTED_UNITS = sorted(UNIT_NAMES.values(), reverse=True)
UNITS = {v: k for k, v in UNIT_NAMES.items()}


def to_data_size(size):
    if size == 0:
        return '0 bytes'

    if size in UNIT_NAMES:
        return UNIT_NAMES[size]

    for unit in SORTED_UNITS:
        name = UNITS[unit]
        many = 'bytes' if name == 'byte' else name
        if size % unit == 0:
            return '%d %s' % (size / unit, many)
        if size >= unit or (size >= unit / 10 and size * 10 % unit == 0):
            return '%.1f %s' % (size / unit, many)


class NonBlockingReader():

    def __init__(self, f, enc='utf-8', block_size=8192):
        fd = f.fileno()
        fl = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
        self.fd = fd
        self.enc = enc or locale.getpreferredencoding(False)
        self.buf = bytearray()
        self.block_size = block_size

    def get_last_line(self):
        line = None
        for line in self:
            pass
        return line

    def __iter__(self):
        while True:
            try:
                block = os.read(self.fd, self.block_size)
            except BlockingIOError:
                return

            if not block:
                if self.buf:
                    yield self.buf.decode(self.enc).rstrip()
                    self.buf.clear()
                return

            block = block.replace(b'\r', b'\n')
            while block:
                b, _, block = block.partition(b'\n')
                self.buf.extend(b)
                line = self.buf.decode(self.enc).rstrip()
                if line:
                    yield line
                self.buf.clear()


class TasksEvent():

    def __init__(self, cls=Event):
        self._cls = cls
        self.clear()

    def __repr__(self):
        return f"<{self.__class__.__name__} tasks={self._counter}>"

    def clear(self):
        self._event = self._cls()
        self._counter = 0

    def add(self):
        self._event.clear()
        self._counter += 1
        logging.info(f"{self}")

    def set(self):
        self._counter -= 1
        logging.info(f"{self}")
        if self._counter == 0:
            self._event.set()

    done = set

    def wait(self, *args, **kwargs):
        return self._event.wait(*args, **kwargs)

    def submit(self, executor, func, *args, **kwargs):
        self.add()
        executor.submit(func, *args, **kwargs)

    def register(self, func):
        def inner(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            finally:
                self.done()
        return inner
