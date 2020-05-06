import termios
import struct
import fcntl
import logging
import pty
import os
import signal
import time
import errno
from itertools import count
import tornado.gen
import tornado.websocket
from tornado.ioloop import IOLoop
from tornado.platform.posix import _set_nonblocking


BUF_SIZE = 32 * 1024
CLIENTS = {}  # {ip: {id: worker}}


def clear_worker(worker, clients):
    ip = worker.src_addr[0]
    workers = clients.get(ip)
    assert worker.id in workers
    workers.pop(worker.id)

    if not workers:
        clients.pop(ip)
        if not clients:
            clients.clear()


def recycle_worker(worker):
    if worker.handler:
        return
    logging.warning(f'Recycling worker {worker.id}')
    worker.close(reason='worker recycled')


class Worker(object):

    indexer = count()

    def __init__(self, cwd, argv, loop, files):
        self.files = files
        self.loop = loop
        self.cwd = cwd
        self.data_to_dst = []
        self.handler = None
        self.mode = IOLoop.READ
        self.closed = False
        self.encoding = "utf-8"
        self.id = str(next(self.indexer))

        logging.info(f">> {' '.join(argv)} ({argv.env})")
        self.pid, self.fd = pty.fork()
        if self.pid == pty.CHILD:
            os.chdir(self.cwd)
            os.execlpe(argv[0], *argv, dict(argv.env, TERM="xterm"))
            assert False
        else:
            logging.info(f"<< pid={self.pid}, fd={self.fd}")
            _set_nonblocking(self.fd)

    @tornado.gen.coroutine
    def __call__(self, fd, events):
        if events & IOLoop.READ:
            yield self.on_read()
        if events & IOLoop.WRITE:
            self.on_write()
        if events & IOLoop.ERROR:
            self.close(reason='error event occurred')

    def set_handler(self, handler):
        if not self.handler:
            self.handler = handler

    def update_handler(self, mode):
        if self.mode != mode:
            self.loop.update_handler(self.fd, mode)
            self.mode = mode
        if mode == IOLoop.WRITE:
            self.loop.call_later(0.1, self, self.fd, IOLoop.WRITE)

    def resize(self, row, col, xpix=0, ypix=0):
        winsize = struct.pack("HHHH", col, row, xpix, ypix)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, winsize)
        logging.info(f"Resized: {row}/{col}")

    @tornado.gen.coroutine
    def on_read(self):
        logging.debug(f'worker {self.id} on read')
        sleep, max_sleep = 0.25, 3
        try:
            while True:
                try:
                    data = os.read(self.fd, BUF_SIZE)
                except OSError as err:
                    if sleep < max_sleep and (err.errno == errno.EAGAIN or err.errno == errno.EWOULDBLOCK):
                        logging.warning(f'{err} on `os.read({self.fd})`, worker {self.id}')
                        yield tornado.gen.sleep(sleep)
                        sleep = sleep * 1.2
                    else:
                        raise
                else:
                    break
        except (OSError, IOError) as e:
            from sentry_sdk import capture_exception
            capture_exception()
            logging.warning(e)
            self.close(reason="eof")
        else:
            logging.debug(f'{len(data)} from {self.pid}')
            if not data:
                self.close(reason="no data")
                return

            try:
                yield self.handler.write_message(data, binary=True)
            except tornado.websocket.WebSocketClosedError:
                self.close(reason='websocket closed')

    def on_write(self):
        logging.debug(f'worker {self.id} on write')
        if not self.data_to_dst:
            return

        data = ''.join(self.data_to_dst).encode(self.encoding)
        logging.debug(f'{len(data)} to {self.pid}')

        try:
            sent = os.write(self.fd, data)
        except (OSError, IOError) as e:
            logging.exception(e)
            self.update_handler(IOLoop.WRITE)
        else:
            self.data_to_dst = []
            data = data[sent:]
            if data:
                self.data_to_dst.append(data)
                self.update_handler(IOLoop.WRITE)
            else:
                self.update_handler(IOLoop.READ)

    def close(self, reason=None):
        if self.closed:
            return
        self.closed = True

        os.close(self.fd)

        try:
            ret = os.waitpid(self.pid, os.WNOHANG)
            if ret == (0, 0):
                logging.warning(f"{self.pid} did not exit, sending SIGTERM")
                os.kill(self.pid, signal.SIGTERM)
                time.sleep(0.05)
                ret = os.waitpid(self.pid, os.WNOHANG)
                if ret == (0, 0):
                    logging.warning(f"{self.pid} still did not exit, sending SIGKILL")
                    os.kill(self.pid, signal.SIGKILL)
                    ret = os.waitpid(self.pid, os.WNOHANG)
                    if ret == (0, 0):
                        logging.error(f"{self.pid} still did not exit!")
            _, rc = ret
        except ChildProcessError as exc:
            logging.info(f'{self.pid} already gone ({exc})')
            rc = None

        logging.info(f'{self.pid} ended (rc={rc})')
        if rc != 0:
            reason = f"error/{reason}/{rc}"
        logging.info(f'Closing worker {self.id} with reason: {reason}')
        if self.handler:
            self.loop.remove_handler(self.fd)
            self.handler.close(reason=reason)

        clear_worker(self, CLIENTS)
        logging.debug(CLIENTS)
