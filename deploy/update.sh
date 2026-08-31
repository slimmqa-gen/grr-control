#!/usr/bin/env bash
# Обновление приложения после изменений в коде.
# Запускается на сервере из папки проекта:
#   bash deploy/update.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="pbk-control"

cd "$APP_DIR"

echo "[1/4] Забираю обновления из GitHub..."
git pull

echo "[2/4] Проверяю зависимости..."
npm install --no-audit --no-fund

echo "[3/4] Собираю приложение..."
npm run build

echo "[4/4] Перезапускаю..."
systemctl restart "$SERVICE"
sleep 3

if systemctl is-active --quiet "$SERVICE"; then
  echo ""
  echo "ГОТОВО. Приложение обновлено и работает."
  echo "База данных и загруженные файлы не тронуты."
else
  echo ""
  echo "ВНИМАНИЕ: приложение не запустилось после обновления."
  echo "Причина:"
  journalctl -u "$SERVICE" -n 30 --no-pager
fi
