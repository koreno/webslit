#!/bin/bash
set -e

GIT_COMMIT=$(git rev-parse HEAD)
VERSION=$(cat version.txt).$GIT_COMMIT

docker build \
    --build-arg=VERSION=$VERSION \
    -t webslit \
    .

trap "docker rm webslit" EXIT
FILES_PATH=${FILES_PATH:-`pwd`}
docker run --init --name webslit -it \
    -p 8888:8888 \
    -v $FILES_PATH:$FILES_PATH \
    -v $FILES_PATH/logs:/logs \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v `which docker`:/usr/bin/docker \
  webslit \
    --static-types=html,jpg,png \
    --files=${FILES_PATH} \
    --log-file-prefix="/logs/webslit.log" \
    --log-to-stderr=true \
    --logging=debug \
    "$@"
