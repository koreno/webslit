#!/usr/bin/env bash
set -e

VERSION=1.2.0

wget -q https://github.com/tigrawap/slit/releases/download/$VERSION/slit_linux_amd64 -O /tmp/slit
chmod a+x /tmp/slit
mv /tmp/slit /usr/bin/slit
