FROM python:3.7-slim
RUN apt-get update && apt-get install -y openssh-server wget curl
RUN \
	echo "IdentityFile=/etc/ssh/ssh_host_ed25519_key" >> /etc/ssh/ssh_config && \
	echo "AuthorizedKeysFile=/etc/ssh/ssh_host_ed25519_key.pub" >> /etc/ssh/sshd_config
COPY install_slit.sh /
RUN /install_slit.sh
COPY requirements.txt /
RUN pip install -r /requirements.txt

COPY . /webslit
EXPOSE 8888
ENTRYPOINT ["/webslit/entrypoint.sh"]

VOLUME /files
WORKDIR /files