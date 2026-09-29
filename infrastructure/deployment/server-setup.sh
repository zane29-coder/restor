#!/usr/bin/env bash
# =============================================================================
# RESTOR — one-time VPS preparation (Ubuntu 22.04 / 24.04, Debian 12).
#
#   sudo ./infrastructure/deployment/server-setup.sh
#
# Installs Docker, Node, a firewall and fail2ban, and creates a non-root
# deploy user. Run once per server, before the first deploy.
# =============================================================================

set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run this with sudo' >&2; exit 1; }

DEPLOY_USER="${DEPLOY_USER:-restor}"

log() { printf '\033[0;34m▸\033[0m %s\n' "$1"; }
ok()  { printf '\033[0;32m✔\033[0m %s\n' "$1"; }

log 'Updating packages'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw fail2ban rsync unattended-upgrades

# --- Docker ------------------------------------------------------------------
if ! command -v docker >/dev/null; then
  log 'Installing Docker'
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

# --- Node (for building the web bundles on the server) -----------------------
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 20 ]]; then
  log 'Installing Node.js 22'
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
ok "Node $(node -v)"

# --- Deploy user -------------------------------------------------------------
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  log "Creating the $DEPLOY_USER user"
  adduser --disabled-password --gecos '' "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"

  # Carry over root's authorised keys so the operator does not lock themselves
  # out before they have added their own.
  if [[ -f /root/.ssh/authorized_keys ]]; then
    install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
    install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
      /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
fi
ok "Deploy user: $DEPLOY_USER"

# --- Firewall ----------------------------------------------------------------
log 'Configuring the firewall'
ufw --force reset >/dev/null
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
# Postgres and Redis are NOT opened: they are reachable only on the container
# network, which is what keeps them off the public internet.
ufw --force enable >/dev/null
ok 'Firewall: 22, 80, 443 only'

# --- SSH hardening -----------------------------------------------------------
log 'Hardening SSH'
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/'  /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd
ok 'SSH: key-only authentication'

# --- fail2ban + automatic security updates -----------------------------------
systemctl enable --now fail2ban >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
ok 'fail2ban and unattended-upgrades enabled'

# --- Swap --------------------------------------------------------------------
# A 1 GB VPS will OOM during `npm ci` without it.
if [[ ! -f /swapfile ]] && [[ "$(free -m | awk '/^Mem:/{print $2}')" -lt 4096 ]]; then
  log 'Creating a 2 GB swap file'
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok 'Swap enabled'
fi

cat <<EOF

$(ok 'Server ready')

Next steps:
  1. su - $DEPLOY_USER
  2. git clone <your-repo> restor && cd restor
  3. cp .env.prod.example .env.prod             # fill in the secrets
     cp backend/.env.example backend/.env.prod  # fill in the secrets
  4. Point your DNS A records at this server's IP
  5. ./infrastructure/deployment/init-ssl.sh
  6. ./infrastructure/deployment/deploy.sh
EOF
