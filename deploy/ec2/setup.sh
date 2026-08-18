#!/usr/bin/env bash
#
# Provisions the mailbox watcher on a fresh Ubuntu 24.04 EC2 instance.
#
#   curl -fsSL <raw-url>/deploy/ec2/setup.sh | sudo bash
# or, after cloning by hand:
#   sudo bash deploy/ec2/setup.sh
#
# Idempotent: safe to re-run.
#
set -euo pipefail

REPO_URL="https://github.com/ViditJain123/cha_erp.git"
INSTALL_DIR="/opt/erp/checklist-app"
SERVICE_USER="erp"
NODE_MAJOR="24"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run with sudo." >&2
  exit 1
fi

echo "=== packages ==="
apt-get update -qq
apt-get install -y -qq git curl ca-certificates

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  echo "=== node ${NODE_MAJOR} ==="
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
node -v

corepack enable

# Attachments are buffered in memory (packages/ingest/src/process.ts holds
# attachment.data as Buffers through hashing, triage and upload) and a tick can
# run up to 20 mailboxes. On a 1 GB free-tier instance that is tight, so give
# the kernel somewhere to spill rather than OOM-killing the worker mid-poll.
MEM_MB=$(free -m | awk '/^Mem:/{print $2}')
if (( MEM_MB < 2048 )) && [[ ! -f /swapfile ]]; then
  echo "=== swap (${MEM_MB}MB RAM detected) ==="
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "=== service user ==="
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"

echo "=== checkout ==="
mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" /opt/erp

echo "=== dependencies ==="
# The filter installs only the worker's dependency graph. @checklist/web is
# excluded, so playwright never downloads browser binaries on this box.
sudo -u "$SERVICE_USER" bash -c "cd '$INSTALL_DIR' && corepack pnpm install --filter '@checklist/worker...' --frozen-lockfile"

echo "=== systemd unit ==="
NODE_BIN="$(command -v node)"
sed "s#^ExecStart=/usr/bin/node#ExecStart=${NODE_BIN}#" \
  "$INSTALL_DIR/deploy/ec2/erp-mail-watcher.service" > /etc/systemd/system/erp-mail-watcher.service
systemctl daemon-reload

echo
if [[ ! -f "$INSTALL_DIR/.env.local" ]]; then
  install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 600 \
    "$INSTALL_DIR/deploy/windows/env.local.template" "$INSTALL_DIR/.env.local"
  echo "NEXT STEP: fill in $INSTALL_DIR/.env.local, then:"
  echo "  sudo systemctl enable --now erp-mail-watcher"
  echo
  echo "Set WORKER_INSTANCE_ID to something unique for this box (e.g. ec2-mumbai-1)."
else
  chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env.local"
  chmod 600 "$INSTALL_DIR/.env.local"
  echo "Enabling service..."
  systemctl enable --now erp-mail-watcher
  systemctl --no-pager status erp-mail-watcher | head -12
fi

echo
echo "Logs:  journalctl -u erp-mail-watcher -f -o cat"
