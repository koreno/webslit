## WebSlit

WebSlit is an integration of WebSSH and Slit, providing a simple web application for viewing large log files.

### Features

* Keyboard-based folder navigation
* Fullscreen, terminal-based user-experience for log-file viewing
* HTML files are served statically (useful with logs from tools such as TestComplete)
* Help with Keyboard Bindings on F1


### Preview

![Navigator](https://github.com/koreno/webslit/raw/master/preview/navigator.png)
![Slit](https://github.com/koreno/webslit/raw/master/preview/slit.png)


### Installation

The following will launch WebSlit listening on port 8888, serving files from the host's /var
```
docker run -d -p 8888:8888 -v /var:/files koreno/webslit:latest
```

You can then open http://localhost:8888 to browse your log files


### How it works
```
+---------+     http     +---------------------------------+
| browser | <==========> | webslit <==> slit <==> log file |
+---------+   websocket  +---------------------------------+
```

