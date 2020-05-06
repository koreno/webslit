import os
import logging
import tornado.web
import tornado.ioloop
from tornado.process import cpu_count
import concurrent.futures

from sentry_sdk.integrations.tornado import TornadoIntegration
import sentry_sdk

from tornado.options import options
from webslit import handler, __version__
from webslit.handler import IndexHandler, VueHandler, WsockHandler, NotFoundHandler
from webslit.settings import get_app_settings, get_server_settings, get_ssl_context
from webslit.file_handlers import StaticFileHandler

from webslit.scrubbers import start_scrubbers


def make_handlers(loop, options):
    handler_params = dict(loop=loop, root=options.files)

    static_types = [t for t in options.static_types.split(",") if t] or ['__']
    StaticFileHandler.register(static_types)
    static_types_re = "|".join(static_types)

    handlers = [
        (r"/static-files/(.*)", tornado.web.StaticFileHandler, dict(path=options.files)),
        (rf"/(.*\.({static_types_re}))", tornado.web.RedirectHandler, dict(url="/static-files/{0}")),
        (r'/_ws', WsockHandler, dict(loop=loop)),
        (r"/_(\w+)", VueHandler, handler_params),
        (r'/(.*)?', IndexHandler, dict(loop=loop)),
    ]
    return handlers


def app_listen(app, port, address, server_settings):
    app.listen(port, address, **server_settings)
    if not server_settings.get('ssl_options'):
        server_type = 'http'
    else:
        server_type = 'https'
        handler.redirecting = True if options.redirect else False
    logging.info(
        f'Listening on {address}:{port} ({server_type})'
    )


class Formatter():

    def __init__(self, fmt):
        self.fmt = fmt

    def __mod__(self, d):
        src = d["pathname"]
        if "site-packages" in src:
            src = "*" + d["pathname"].split("site-packages")[-1]
        if "python3.7" in src:
            src = "*" + d["pathname"].split("python3.7")[-1]
        src = f"{src}:{d['lineno']}"
        d = dict(d, src=src)
        return self.fmt % d


def main():
    options.parse_command_line()

    handlers = logging.getLogger().handlers

    stderr_handler = handlers[-1]
    stderr_handler.setLevel(logging.INFO)

    for h in handlers:
        h.formatter._fmt = Formatter("|".join((
            "%(color)s%(levelname)1.1s",
            "%(asctime)s.%(msecs)03.0f",
            "%(thread)X",
            "%(src)-30s%(end_color)s",
            "%(message)s"
        )))

    if options.sentry_url:
        sentry_sdk.init(
            options.sentry_url,
            release=__version__,
            environment=options.sentry_environment,
            integrations=[TornadoIntegration()]
        )

    os.umask(0000)  # especially so that downloads are read-writeable for non-root (since we are root)

    logging.info(f"WebSlit {__version__}")

    loop = tornado.ioloop.IOLoop.current()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=cpu_count() * 5)
    loop.set_default_executor(executor)

    settings = get_app_settings(options)
    handlers = make_handlers(loop, options)
    app = tornado.web.Application(handlers, default_handler_class=NotFoundHandler, **settings)

    ssl_ctx = get_ssl_context(options)
    server_settings = get_server_settings(options)
    app_listen(app, options.port, options.address, server_settings)
    if ssl_ctx:
        server_settings.update(ssl_options=ssl_ctx)
        app_listen(app, options.sslport, options.ssladdress, server_settings)

    start_scrubbers()
    loop.start()


if __name__ == '__main__':
    main()
