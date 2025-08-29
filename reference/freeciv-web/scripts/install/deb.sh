#   Copyright (C) 2018  The Freeciv-web project
#
#   This program is free software: you can redistribute it and/or modify
#   it under the terms of the GNU Affero General Public License as published by
#   the Free Software Foundation, either version 3 of the License, or
#   (at your option) any later version.
#
#   This program is distributed in the hope that it will be useful,
#   but WITHOUT ANY WARRANTY; without even the implied warranty of
#   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#   GNU Affero General Public License for more details.
#
#   You should have received a copy of the GNU Affero General Public License
#   along with this program.  If not, see <http://www.gnu.org/licenses/>.

dependencies="\
  acl \
  ninja-build \
  wget \
  build-essential \
  curl \
  git \
  gnupg \
  imagemagick \
  libcurl4-openssl-dev \
  libicu-dev \
  libjansson-dev \
  liblzma-dev \
  libzstd-dev \
  libmagickcore.*extra \
  libmagickwand-dev \
  libsqlite3-dev \
  maven \
  mariadb-server \
  nginx \
  patch \
  pkg-config \
  pngcrush \
  procps \
  python3-minimal \
  python3-pip \
  python3-setuptools \
  python3-dev \
  python3-wheel \
  python3-tornado \
  python3-pil \
  python3-requests \
  python3-mysqldb \
  sed \
  tar \
  unzip \
  zlib1g-dev \
"

INSTALLED_TOMCAT=N
INSTALLED_NODEJS=N
APT_GET='DEBIAN_FRONTEND=noninteractive apt-get -y -qq -o=Dpkg::Use-Pty=0'

sudo ${APT_GET} update

if [ "$DEB_NO_TOMCAT" != "Y" ] && apt-get --simulate install tomcat10 &> /dev/null; then
  dependencies="${dependencies} tomcat10 tomcat10-admin"
  INSTALLED_TOMCAT=Y
else
  INSTALLED_TOMCAT=N
fi

debian_nodejs_packages="nodejs npm handlebars node-opener"
if [ $(lsb_release -rs) = "testing" ] && [ $(lsb_release -is) = "Debian" ] \
   && apt-get --simulate install ${debian_nodejs_packages} &> /dev/null; then
  dependencies="${dependencies} ${debian_nodejs_packages}"
  INSTALLED_NODEJS=Y
else
  INSTALLED_NODEJS=N
fi

# Install openjdk-21-jdk-headless, if available.
# Otherwise install openjdk-17-jdk-headless
if apt-get --simulate install openjdk-21-jdk-headless &> /dev/null; then
  dependencies="${dependencies} openjdk-21-jdk-headless"
else
  dependencies="${dependencies} openjdk-17-jdk-headless"
fi

# Install lua-5.4, if available. Otherwise it will be built from the copy
# included with the server.
if apt-get --simulate install liblua5.4-dev &> /dev/null; then
  dependencies="${dependencies} liblua5.4-dev"
fi

echo "==== Installing Dependencies ===="
echo "mariadb setup..."
sudo debconf-set-selections <<< "mysql-server mysql-server/root_password password ${DB_ROOT_PASSWORD}"
sudo debconf-set-selections <<< "mysql-server mysql-server/root_password_again password ${DB_ROOT_PASSWORD}"
echo "apt-get install dependencies"
sudo ${APT_GET} install --no-install-recommends ${dependencies}

if [ "${INSTALLED_TOMCAT}" = N ]; then
  ext_install_tomcat10
fi

TMPINSTDIR=$(mktemp -d)

echo "==== Installing Node.js ===="
if [ "${INSTALLED_NODEJS}" = N ]; then
  NODE_MAJOR=20
  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
  sudo ${APT_GET} update
  sudo ${APT_GET} install --no-install-recommends nodejs
  if ! command -v npm >/dev/null ; then
    sudo ${APT_GET} install --no-install-recommends npm
  fi
  if apt-get --simulate install node-opener &> /dev/null ; then
    sudo ${APT_GET} install --no-install-recommends node-opener
  fi
fi

# Populate ~/.config with current user
npm help > /dev/null

export MESON_VER="0.60.3"

echo "==== Installing Meson ===="
if ! sudo ${APT_GET} satisfy "meson (>= ${MESON_VER})" ; then
  ext_install_meson
fi
