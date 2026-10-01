#!/usr/bin/env bash
# Закрытый доступ к программе.
#
#   sudo bash deploy/lockdown.sh новыйдомен.ru
#
# Что делает:
#   1. выпускает сертификат https на новый адрес;
#   2. ставит «второй замок» — вход по логину и паролю ещё ДО программы.
#      Пускает только тех, кого вы добавили (deploy/access.sh);
#   3. всё остальное закрывает: старый адрес (24pbk.ru), вход по IP 147.45.215.116,
#      любые другие имена — соединение просто обрывается, страница не открывается;
#   4. запрещает поисковикам показывать сайт (robots.txt, noindex);
#   5. программа слушает только 127.0.0.1 — в обход nginx не попасть;
#   6. старый сертификат 24pbk.ru удаляется.
#
# Бот MAX продолжает работать: адрес /api/max/webhook пропускается без замка,
# он защищён своим секретным ключом.
#
# Откат: скрипт сохраняет прежние настройки и печатает команду возврата.
set -euo pipefail

D="${1:-}"
SERVICE="${SERVICE:-pbk-control}"
PORT="${PORT:-5000}"
SITE="/etc/nginx/sites-available/${SERVICE}"
ACCESS="/etc/nginx/pbk-access"
OLD="${OLD_DOMAIN:-24pbk.ru}"

die() { echo "ОШИБКА: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "запускайте от root: sudo bash deploy/lockdown.sh новыйдомен.ru"
[ -n "$D" ] || die "укажите новый адрес: sudo bash deploy/lockdown.sh новыйдомен.ru"
echo "$D" | grep -Eq '^[a-z0-9.-]+\.[a-z]{2,}$' || die "адрес латиницей, без https:// и /, например pbk-work.ru"
[ "$D" != "$OLD" ] || die "новый адрес совпадает со старым"

echo "=============================================="
echo " Закрытый доступ: https://$D"
echo " Будет закрыто: $OLD, вход по IP, любые другие адреса"
echo "=============================================="

# ---------- 1. адрес указывает на этот сервер ----------
MYIP="$(curl -s4 --max-time 8 https://ifconfig.me || hostname -I | awk '{print $1}')"
DIP="$(getent ahostsv4 "$D" | awk 'NR==1{print $1}')"
[ -n "$DIP" ] || die "адрес $D ещё не найден в DNS. Добавьте у регистратора A-запись на $MYIP и подождите 15–60 минут"
[ "$DIP" = "$MYIP" ] || die "$D указывает на $DIP, а этот сервер — $MYIP. Исправьте A-запись у регистратора"
echo "[1/7] DNS в порядке: $D → $MYIP"

# ---------- 2. нужные программы ----------
NEED=""
command -v certbot >/dev/null || NEED="$NEED certbot python3-certbot-nginx"
command -v htpasswd >/dev/null || NEED="$NEED apache2-utils"
if [ -n "$NEED" ]; then
  echo "[2/7] Устанавливаю:$NEED"
  apt-get update -qq && apt-get install -y -qq $NEED >/dev/null
else
  echo "[2/7] Программы на месте"
fi

# ---------- 3. список допуска ----------
if [ ! -s "$ACCESS" ]; then
  echo "[3/7] Список допуска пуст — создаю ПЕРВЫЙ вход (это вы)."
  read -rp "    Логин для входа (латиницей): " U
  [ -n "$U" ] || die "логин пустой"
  htpasswd -cm "$ACCESS" "$U"
else
  echo "[3/7] Список допуска уже есть: $(cut -d: -f1 "$ACCESS" | paste -sd, -)"
fi
chown root:www-data "$ACCESS"; chmod 640 "$ACCESS"

# ---------- 4. сертификат ----------
echo "[4/7] Сертификат https для $D..."
if [ ! -f "/etc/letsencrypt/live/$D/fullchain.pem" ]; then
  certbot certonly --nginx -d "$D" --non-interactive --agree-tos --register-unsafely-without-email \
    || die "сертификат не выпущен. Прежние настройки не менялись"
fi
# заглушка для «чужих» адресов на 443 (соединение будет оборвано)
if [ ! -f /etc/nginx/pbk-default.crt ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=invalid" \
    -keyout /etc/nginx/pbk-default.key -out /etc/nginx/pbk-default.crt >/dev/null 2>&1
fi

# ---------- 5. настройки nginx ----------
echo "[5/7] Настройки веб-сервера..."
BK="/root/nginx-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"; cp -a /etc/nginx/sites-available /etc/nginx/sites-enabled "$BK/"
PROXY="
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;"
cat > "$SITE" <<NGINX
# Создано deploy/lockdown.sh — закрытый доступ. Прежние настройки: $BK
# Любой другой адрес, IP сервера, $OLD — соединение обрывается без ответа.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_certificate     /etc/nginx/pbk-default.crt;
    ssl_certificate_key /etc/nginx/pbk-default.key;
    return 444;
}
server {
    listen 80;
    listen [::]:80;
    server_name $D;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $D;
    ssl_certificate     /etc/letsencrypt/live/$D/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$D/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    server_tokens off;
    client_max_body_size 30M;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;

    location = /robots.txt {
        default_type text/plain;
        return 200 "User-agent: *\nDisallow: /\n";
    }
    # бот MAX — без замка, защищён секретным ключом
    location ^~ /api/max/webhook {$PROXY
    }
    location / {
        auth_basic "PBK";
        auth_basic_user_file $ACCESS;$PROXY
    }
}
NGINX
# остальные включённые сайты (например, созданные certbot для $OLD) — отключаем
for f in /etc/nginx/sites-enabled/*; do
  [ "$(readlink -f "$f")" = "$SITE" ] && continue
  echo "    отключаю $(basename "$f")"; rm -f "$f"
done
ln -sf "$SITE" "/etc/nginx/sites-enabled/${SERVICE}"
if ! nginx -t 2>/tmp/nginx-test.log; then
  cat /tmp/nginx-test.log
  rm -rf /etc/nginx/sites-available /etc/nginx/sites-enabled
  cp -a "$BK/sites-available" "$BK/sites-enabled" /etc/nginx/
  nginx -t && systemctl reload nginx
  die "настройки не прошли проверку — вернул прежние, сайт работает как раньше"
fi
systemctl reload nginx

# ---------- 6. программа только для nginx ----------
echo "[6/7] Программа слушает только 127.0.0.1..."
mkdir -p "/etc/systemd/system/${SERVICE}.service.d"
printf '[Service]\nEnvironment=HOST=127.0.0.1\n' > "/etc/systemd/system/${SERVICE}.service.d/host.conf"
systemctl daemon-reload && systemctl restart "$SERVICE"
sleep 3
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null && echo "    программа отвечает" || echo "ВНИМАНИЕ: программа не ответила, проверьте: systemctl status $SERVICE"
ufw deny "${PORT}/tcp" >/dev/null 2>&1 || true

# ---------- 7. старый сертификат ----------
echo "[7/7] Старый адрес $OLD..."
if certbot certificates 2>/dev/null | grep -q "Certificate Name: $OLD"; then
  certbot delete --cert-name "$OLD" --non-interactive >/dev/null 2>&1 && echo "    сертификат $OLD удалён"
fi

cat <<DONE

==============================================
 ГОТОВО. Программа: https://$D
==============================================
 Сейчас же, в течение пары минут:
  1. Откройте https://$D — браузер спросит логин и пароль допуска,
     затем обычный вход в программу.
  2. «Сотрудники и вахты» → «Настройка уведомлений» → «Адрес для событий»:
     https://$D/api/max/webhook → «Включить webhook». Иначе бот MAX молчит.
  3. У регистратора удалите A-записи $OLD и не продлевайте домен.

 Допуск людей:
   sudo bash deploy/access.sh list           — кто допущен
   sudo bash deploy/access.sh add ivanov     — пустить человека (спросит пароль)
   sudo bash deploy/access.sh del ivanov     — закрыть человеку вход

 Вернуть всё как было:
   rm -rf /etc/nginx/sites-available /etc/nginx/sites-enabled && cp -a $BK/sites-available $BK/sites-enabled /etc/nginx/ && systemctl reload nginx
DONE
