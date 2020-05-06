import logging
import tornado.ioloop
from tornado import gen
from tornado.util import TimeoutError
from easypy.decorations import parametrizeable_decorator
from easypy.units import HOUR, MINUTE

SCRUBBERS = []


@parametrizeable_decorator
def scrubber(func=None, period=HOUR):

    @gen.coroutine
    def inner():
        loop = tornado.ioloop.IOLoop.current()
        try:
            yield gen.with_timeout(loop.time() + MINUTE, loop.run_in_executor(None, func))
        except TimeoutError:
            logging.warning(f"Timeout error on scrubber: {func}")

    SCRUBBERS.append((inner, period))
    return func


def start_scrubbers():
    loop = tornado.ioloop.IOLoop.current()
    for func, period in SCRUBBERS:
        tornado.ioloop.PeriodicCallback(func, period * 1000, 0.1).start()
        loop.call_later(5, func)
