#!/usr/bin/env bash
# Кто может открыть сайт программы («второй замок» до входа в программу).
#
#   sudo bash deploy/access.sh list           — кто допущен
#   sudo bash deploy/access.sh add ivanov     — пустить (пароль спросит, на экране не виден)
#   sudo bash deploy/access.sh del ivanov     — закрыть вход
#
# Изменения действуют сразу, перезапуск не нужен.
set -euo pipefail
ACCESS="/etc/nginx/pbk-access"
die() { echo "ОШИБКА: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "запускайте от root: sudo bash deploy/access.sh ..."
command -v htpasswd >/dev/null || { apt-get update -qq && apt-get install -y -qq apache2-utils >/dev/null; }

CMD="${1:-list}"; U="${2:-}"
case "$CMD" in
  list)
    [ -s "$ACCESS" ] || { echo "Список пуст. Сначала: sudo bash deploy/lockdown.sh новыйдомен.ru"; exit 0; }
    echo "Допущены:"; cut -d: -f1 "$ACCESS" | sed 's/^/  • /' ;;
  add)
    [ -n "$U" ] || die "укажите логин: sudo bash deploy/access.sh add ivanov"
    echo "$U" | grep -Eq '^[A-Za-z0-9._-]+$' || die "логин — латиница, цифры, точка, дефис"
    if [ -s "$ACCESS" ]; then htpasswd -m "$ACCESS" "$U"; else htpasswd -cm "$ACCESS" "$U"; fi
    chown root:www-data "$ACCESS"; chmod 640 "$ACCESS"
    echo "Готово: $U может открыть сайт. Пароль передайте лично, не в общий чат." ;;
  del)
    [ -n "$U" ] || die "укажите логин: sudo bash deploy/access.sh del ivanov"
    [ "$(grep -c . "$ACCESS" 2>/dev/null || echo 0)" -gt 1 ] || die "это последний вход — себя удалить нельзя, иначе никто не попадёт"
    htpasswd -D "$ACCESS" "$U"
    echo "Готово: $U больше не может открыть сайт." ;;
  *) die "команды: list, add ЛОГИН, del ЛОГИН" ;;
esac
