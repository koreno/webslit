FROM rust as ziplog-builder
ARG ZIPLOG_VERSION=937c80b0b61d91929865462d3e08616a964f27b3
RUN git clone --single-branch --depth 1 https://github.com/da-x/ziplog.git && \
	cd ziplog && \
	git checkout -B build $ZIPLOG_VERSION && \
	cargo build --release


FROM golang:latest as slit-builder
RUN cd / && \
	git clone http://github.com/tigrawap/slit && \
	cd slit && \
	git fetch --tags && \
	git checkout 1.3.0 && \
	make


FROM python:3.7-slim
COPY install_packages.sh /tmp
RUN /tmp/install_packages.sh

EXPOSE 8888
ENTRYPOINT ["python", "-m", "webslit.main"]

COPY requirements.txt /
RUN pip install --no-cache-dir -r /requirements.txt
COPY --from=ziplog-builder /ziplog/target/release/ziplog /usr/bin/ziplog
COPY --from=slit-builder /slit/bin/slit /bin/

HEALTHCHECK --interval=60s --timeout=3s --start-period=5s \
	CMD curl -f http://localhost:8888/_entry?path=/ || exit 1

COPY termshark.toml /root/.config/termshark/
COPY bashrc /root/.bashrc

ENV PYTHONFAULTHANDLER=yes

COPY webslit /webslit
COPY webslit/ansi.py webslit/keyboard.py /webslit/static/js/
WORKDIR /

ARG VERSION

LABEL version=$VERSION
RUN echo $VERSION > version.info