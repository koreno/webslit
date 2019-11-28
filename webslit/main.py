import logging
import tornado.web
import tornado.ioloop

from tornado.options import options
from webslit import handler
from webslit.handler import IndexHandler, WsockHandler, NotFoundHandler
from webslit.settings import (
    get_app_settings, get_host_keys_settings, get_policy_setting,
    get_ssl_context, get_server_settings
)


def make_handlers(loop, options):
    host_keys_settings = get_host_keys_settings(options)
    policy = get_policy_setting(options, host_keys_settings)
    handler_params = dict(loop=loop, policy=policy, host_keys_settings=host_keys_settings)

    handlers = [
        (r'/ws', WsockHandler, dict(loop=loop)),
        (r"/files/(.*\.html)", tornado.web.RedirectHandler, dict(url="/static-files/{0}")),
        (r'/files(/.*)?', IndexHandler, handler_params),
        (r"/static-files/(.*)", tornado.web.StaticFileHandler, dict(path="/files")),
        (r'/', IndexHandler, handler_params),
    ]
    return handlers


def make_app(handlers, settings):
    settings.update(default_handler_class=NotFoundHandler)
    return tornado.web.Application(handlers, **settings)


def app_listen(app, port, address, server_settings):
    app.listen(port, address, **server_settings)
    if not server_settings.get('ssl_options'):
        server_type = 'http'
    else:
        server_type = 'https'
        handler.redirecting = True if options.redirect else False
    logging.info(
        'Listening on {}:{} ({})'.format(address, port, server_type)
    )


def main():
    options.parse_command_line()
    loop = tornado.ioloop.IOLoop.current()
    app = make_app(make_handlers(loop, options), get_app_settings(options))
    ssl_ctx = get_ssl_context(options)
    server_settings = get_server_settings(options)
    app_listen(app, options.port, options.address, server_settings)
    if ssl_ctx:
        server_settings.update(ssl_options=ssl_ctx)
        app_listen(app, options.sslport, options.ssladdress, server_settings)
    loop.start()


if __name__ == '__main__':
    main()
