#!/usr/bin/env bash
# Проверка почтового сбора и суточной сводки. Ничего не меняет.
# Запуск: cd /opt/pbk-control && sudo bash deploy/diag.sh
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${SERVICE:-pbk-control}"
# берём DATA_DIR из настроек службы, если он там задан
ENV_DATA="$(systemctl show "$SERVICE" -p Environment 2>/dev/null | tr ' ' '\n' | sed -n 's/^DATA_DIR=//p' | head -1)"
export DATA_DIR="${DATA_DIR:-${ENV_DATA:-/var/pbk-data}}"
cd "$APP_DIR" && node deploy/diag.cjs
echo
echo "=== 7. Сообщения службы за 6 часов (почта, сводка, ошибки) ==="
journalctl -u "$SERVICE" --since "-6h" --no-pager 2>/dev/null \
  | grep -E "Сводка|почт|Почт|mail|IMAP|Ошибка|Error|ОШИБКА" | grep -v "GET /api" | tail -25 || echo "журнал недоступен"
