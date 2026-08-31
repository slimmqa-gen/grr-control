#!/usr/bin/env bash
# Первичная настройка сервера под приложение ПБК-Контроль.
# Запускается один раз на чистом сервере Ubuntu 22.04/24.04 от имени root:
#   bash deploy/setup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="/var/pbk-data"
PORT="5000"
SERVICE="pbk-control"

echo "=============================================="
echo " Настройка сервера для ПБК-Контроль"
echo " Папка проекта: $APP_DIR"
echo " Папка данных:  $DATA_DIR"
echo "=============================================="

if [ "$(id -u)" -ne 0 ]; then
  echo "ОШИБКА: запускайте от root. Выполните: sudo bash deploy/setup.sh"
  exit 1
fi

echo ""
echo "[1/7] Обновление списка пакетов..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg build-essential python3 ufw nginx >/dev/null

echo "[2/7] Установка Node.js 20..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1)" != "v20" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
echo "      Node.js $(node -v), npm $(npm -v)"

echo "[3/7] Папка для базы данных и файлов..."
mkdir -p "$DATA_DIR/pbk_files"
chmod 750 "$DATA_DIR"

echo "[4/7] Установка зависимостей и сборка (займёт 3-5 минут)..."
cd "$APP_DIR"
npm install --no-audit --no-fund
npm run build

echo "[5/7] Настройка автозапуска (systemd)..."
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=PBK Control (GRR)
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/dist/index.cjs
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=DATA_DIR=${DATA_DIR}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

echo "[6/7] Настройка веб-сервера nginx..."
cat > /etc/nginx/sites-available/"$SERVICE" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # загрузка файлов сводок до 30 МБ
    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/"$SERVICE" /etc/nginx/sites-enabled/"$SERVICE"
nginx -t
systemctl reload nginx

echo "[7/7] Настройка файрвола..."
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

sleep 3
echo ""
echo "=============================================="
if systemctl is-active --quiet "$SERVICE"; then
  echo " ГОТОВО. Приложение запущено."
else
  echo " ВНИМАНИЕ: приложение не запустилось."
  echo " Посмотрите причину командой:"
  echo "   journalctl -u ${SERVICE} -n 40 --no-pager"
fi
echo ""
echo " Откройте в браузере:  http://$(curl -s -m 5 ifconfig.me || echo 'IP-вашего-сервера')"
echo " Логин director, пароль director — смените сразу после входа."
echo ""
echo " Полезные команды:"
echo "   systemctl status ${SERVICE}      — состояние"
echo "   journalctl -u ${SERVICE} -f      — логи в реальном времени"
echo "   bash deploy/update.sh            — обновить приложение"
echo "=============================================="
