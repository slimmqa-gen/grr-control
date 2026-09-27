#!/usr/bin/env bash
# Настройка выгрузки резервных копий в облако (WebDAV).
# Запуск: sudo bash deploy/backup-cloud.sh
# Пароль вводится здесь, на сервере, и хранится в /etc/pbk-backup.env (доступ только root).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Запустите от root: sudo bash deploy/backup-cloud.sh"; exit 1; }

echo "Куда выгружать копии:"
echo "  1) Яндекс Диск   (нужен пароль приложения: id.yandex.ru → Безопасность → Пароли приложений → «Файлы»)"
echo "  2) Облако Mail.ru (нужен пароль для внешнего приложения с доступом к Облаку)"
echo "  3) Другой WebDAV"
read -r -p "Выберите 1, 2 или 3: " choice
case "$choice" in
  1) url="https://webdav.yandex.ru" ;;
  2) url="https://webdav.cloud.mail.ru" ;;
  *) read -r -p "Адрес WebDAV (https://...): " url ;;
esac
read -r -p "Логин (почта): " user
read -r -s -p "Пароль приложения (не отображается): " pass; echo

code="$(curl -s -m 30 -u "$user:$pass" -X PROPFIND -H 'Depth: 0' -o /dev/null -w '%{http_code}' "$url/")"
case "$code" in
  207|200) echo "Подключение работает." ;;
  401|403) echo "ОШИБКА: облако не пустило (код $code). Проверьте логин и пароль приложения."; exit 1 ;;
  *) echo "ОШИБКА: облако не ответило как ожидалось (код $code)."; exit 1 ;;
esac

umask 077
printf 'WEBDAV_URL=%q\nWEBDAV_USER=%q\nWEBDAV_PASS=%q\n' "$url" "$user" "$pass" > /etc/pbk-backup.env
chmod 600 /etc/pbk-backup.env
echo "Сохранено. Делаю пробную копию…"
bash "$(dirname "${BASH_SOURCE[0]}")/backup.sh"
