FROM debian:stable-slim
WORKDIR /home/academico

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get -y update --fix-missing --no-install-recommends
RUN apt-get -y upgrade
RUN apt-get -yq install apt-utils nano wget dialog libgmp-dev re2c libmhash-dev libmcrypt-dev file 
RUN apt-get -y install --fix-missing apt-utils build-essential git curl zip openssl net-tools nano
#RUN apt-get -y install default-jre default-jdk
RUN mkdir -p /usr/share/man/man1
RUN apt-get -y install default-jre
RUN apt-get -y install default-jdk
ADD "https://github.com/cdr/code-server/releases/download/v3.4.1/code-server_3.4.1_amd64.deb" ./code.deb
RUN dpkg -i code.deb && rm code.deb

RUN groupadd academico && useradd -u 1000 -m -g academico -s /bin/bash academico;
EXPOSE 8443
USER academico
COPY .local /home/academico/.local
#RUN cd /home/projeto
ENTRYPOINT ["/usr/bin/code-server", "--auth", "none", "--bind-addr", "0.0.0.0:8443"]
