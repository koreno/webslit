#!/usr/bin/env bash
set -e

apt-get update

# Base
echo "wireshark-common wireshark-common/install-setuid boolean true" | debconf-set-selections

export DEBIAN_FRONTEND=noninteractive
apt-get -y install apt-transport-https \
     ca-certificates \
     wget curl \
     gnupg2 \
     pv nano \
     tshark tcpdump \
     zstd psmisc file \
     software-properties-common

apt-get clean

# Termshark
wget https://github.com/gcla/termshark/releases/download/v2.1.1/termshark_2.1.1_linux_x64.tar.gz
tar --strip-components 1 -xzf termshark_2.1.1_linux_x64.tar.gz
mv termshark /usr/local/bin/
rm -rf termshark_2.1.1_linux_x64.tar.gz
