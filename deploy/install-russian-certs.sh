#!/usr/bin/env bash
# Установка сертификатов Минцифры (Russian Trusted CA).
#
# Нужны для работы с API мессенджера MAX: домен platform-api2.max.ru выпущен
# удостоверяющим центром Минцифры, которого нет в списках по умолчанию.
# Node.js использует свой набор корневых сертификатов, поэтому одной установки
# в систему недостаточно — скрипт дополнительно прописывает NODE_EXTRA_CA_CERTS
# для службы pbk-control.
set -euo pipefail

SERVICE="pbk-control"
CERT_DIR="/usr/local/share/ca-certificates"
BUNDLE="/usr/local/share/ca-certificates/russian_trusted_bundle.crt"
ROOT_URL="https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt"
SUB_URL="https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt"

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите с правами root: sudo bash deploy/install-russian-certs.sh"
  exit 1
fi

echo "1. Загрузка сертификатов Минцифры"
tmp="$(mktemp -d)"
curl -fsSL "$ROOT_URL" -o "$tmp/root.crt"
curl -fsSL "$SUB_URL" -o "$tmp/sub.crt"

echo "2. Установка в систему"
mkdir -p "$CERT_DIR"
# переводы строк из Windows ломают разбор PEM, поэтому убираем их
tr -d '\r' < "$tmp/root.crt" > "$CERT_DIR/russian_trusted_root_ca.crt"
tr -d '\r' < "$tmp/sub.crt" > "$CERT_DIR/russian_trusted_sub_ca.crt"
cat "$CERT_DIR/russian_trusted_root_ca.crt" "$CERT_DIR/russian_trusted_sub_ca.crt" > "$BUNDLE"
update-ca-certificates >/dev/null

echo "3. Проверка связи с API MAX"
check() {
  curl -s -o /dev/null -w '%{http_code}' "$@" https://platform-api2.max.ru/me \
    -H 'Authorization: check' --max-time 25 2>/dev/null || true
}
code="$(check)"
if [ "$code" = "000" ]; then
  # системного доверия не хватило — пробуем прямо с загруженной связкой
  code="$(check --cacert "$BUNDLE")"
fi
if [ "$code" = "000" ]; then
  code="$(check --cacert "$CERT_DIR/russian_trusted_root_ca.crt")"
fi

if [ "$code" = "401" ]; then
  echo "   соединение установлено (401 — ожидаемый ответ на проверочный токен)"
elif [ "$code" = "000" ]; then
  echo "   проверка связи не прошла. Подробности ошибки:"
  curl -sS -o /dev/null --cacert "$BUNDLE" https://platform-api2.max.ru/me \
    -H 'Authorization: check' --max-time 25 2>&1 | sed 's/^/     /' || true
  echo "   сертификаты всё равно установлены — программа попробует соединиться сама"
else
  echo "   ответ сервера MAX: $code"
fi

echo "4. Передача сертификатов службе $SERVICE"
mkdir -p "/etc/systemd/system/${SERVICE}.service.d"
cat > "/etc/systemd/system/${SERVICE}.service.d/certs.conf" <<CONF
[Service]
Environment=NODE_EXTRA_CA_CERTS=$BUNDLE
CONF
systemctl daemon-reload
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" && echo "   служба перезапущена" || {
  echo "   служба не поднялась, смотрите: journalctl -u $SERVICE -n 50"
  exit 1
}

rm -rf "$tmp"
echo
echo "Готово. Откройте «Вызов на вахту» и нажмите «Проверить бота»."

echo
echo "Диагностика, если связь не установилась:"
echo "  openssl s_client -connect platform-api2.max.ru:443 -servername platform-api2.max.ru -CAfile $BUNDLE < /dev/null 2>&1 | grep 'Verify return code'"
