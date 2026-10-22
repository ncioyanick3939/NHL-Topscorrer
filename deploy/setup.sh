#!/usr/bin/env bash
# NHL Topscorer on a free Linux server (Google Cloud e2-micro, Oracle Always Free, Raspberry Pi ...).
# Installs Node.js, the app as a service that always runs, HTTPS (Caddy) and an automatic update every 10 minutes.
# Usage on the server:  curl -fsSL https://raw.githubusercontent.com/ncioyanick3939/NHL-Topscorrer/main/deploy/setup.sh | sudo bash
# Own domain:           ... | sudo bash -s -- meine-domain.ch
# Running it again is safe: it updates the app and keeps the database.
set -euo pipefail

REPO=https://github.com/ncioyanick3939/NHL-Topscorrer.git
BRANCH=${BRANCH:-main}
APP=/opt/nhl-topscorer
DATA=/var/lib/nhl-topscorer   # database and invite code: this is the folder to back up

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "== Pakete"
apt-get update -q
apt-get install -y -q curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

# Small machines (1 GB RAM) need swap, otherwise apt or node can run out of memory.
if [ ! -f /swapfile ] && [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 2000000 ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Node.js 22"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
NODE=$(command -v node)

echo "== App"
id nhl >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin nhl
mkdir -p "$DATA" && chown nhl:nhl "$DATA"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO" "$APP"
fi

# Settings that survive updates. INVITE_CODE can be set here (sudo nano /etc/nhl-topscorer.env).
[ -f /etc/nhl-topscorer.env ] || echo "# INVITE_CODE=mein-code" > /etc/nhl-topscorer.env

cat > /etc/systemd/system/nhl-topscorer.service <<UNIT
[Unit]
Description=NHL Topscorer
After=network-online.target
Wants=network-online.target

[Service]
User=nhl
WorkingDirectory=$APP
Environment=PORT=3000 DATA_DIR=$DATA COOKIE_SECURE=1 TRUST_PROXY=1 NODE_ENV=production
EnvironmentFile=-/etc/nhl-topscorer.env
ExecStart=$NODE --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# Auto update: every 10 minutes pull the branch, restart only when something changed.
cat > /usr/local/bin/nhl-topscorer-update <<UPD
#!/bin/sh
cd $APP || exit 1
git fetch -q origin $BRANCH || exit 0
[ "\$(git rev-parse HEAD)" = "\$(git rev-parse origin/$BRANCH)" ] && exit 0
git reset -q --hard origin/$BRANCH && systemctl restart nhl-topscorer
UPD
chmod +x /usr/local/bin/nhl-topscorer-update
cat > /etc/systemd/system/nhl-topscorer-update.service <<'UNIT'
[Unit]
Description=NHL Topscorer update
[Service]
Type=oneshot
ExecStart=/usr/local/bin/nhl-topscorer-update
UNIT
cat > /etc/systemd/system/nhl-topscorer-update.timer <<'UNIT'
[Unit]
Description=NHL Topscorer update every 10 minutes
[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable -q --now nhl-topscorer nhl-topscorer-update.timer
systemctl restart nhl-topscorer

echo "== HTTPS (Caddy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi
IP=$(curl -fsS https://api.ipify.org)
DOMAIN=${1:-${IP//./-}.sslip.io}   # free address that points to this server's IP
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy localhost:3000
}
CADDY
systemctl reload caddy || systemctl restart caddy

sleep 3
echo
echo "=================================================="
echo " Fertig! Die App läuft unter:  https://$DOMAIN"
echo " Einladungscode: $(cat "$DATA/invite-code.txt" 2>/dev/null || echo 'siehe /etc/nhl-topscorer.env')"
echo " (Das HTTPS-Zertifikat kann beim ersten Aufruf eine Minute brauchen.)"
echo "=================================================="
