#!/usr/bin/env bash
#
# Pulls new code and restarts the watcher.
#   sudo bash /opt/erp/checklist-app/deploy/ec2/update.sh
#
# Does NOT run database migrations -- `supabase db push` is run once, from
# whichever machine owns the Supabase link.
#
set -euo pipefail

INSTALL_DIR="/opt/erp/checklist-app"
SERVICE_USER="erp"

[[ $EUID -eq 0 ]] || { echo "ERROR: run with sudo." >&2; exit 1; }

echo "=== stopping ==="
systemctl stop erp-mail-watcher

echo "=== git pull ==="
sudo -u "$SERVICE_USER" git -C "$INSTALL_DIR" pull --ff-only

echo "=== dependencies ==="
sudo -u "$SERVICE_USER" bash -c "cd '$INSTALL_DIR' && corepack pnpm install --filter '@checklist/worker...' --frozen-lockfile"

echo "=== starting ==="
systemctl start erp-mail-watcher
sleep 2
systemctl --no-pager status erp-mail-watcher | head -8

echo
echo "Tail:  journalctl -u erp-mail-watcher -f -o cat"
