#!/usr/bin/env bash
# Резервная копия базы данных и загруженных файлов.
# Запуск вручную:  sudo bash deploy/backup.sh
# Копии складываются в /var/pbk-backups, хранятся 30 последних.
# Если настроено облако (sudo bash deploy/backup-cloud.sh), копия дня
# ещё и выгружается туда: одна на каждое число месяца, старые перезаписываются.
set -uo pipefail

DATA_DIR="${DATA_DIR:-/var/pbk-data}"
BACKUP_DIR="/var/pbk-backups"
STAMP="$(date +%Y-%m-%d_%H-%M)"
DAY="$(date +%d)"
STATUS="$DATA_DIR/backup_status.json"
CLOUD_ENV="/etc/pbk-backup.env"

mkdir -p "$BACKUP_DIR"
command -v sqlite3 >/dev/null 2>&1 || apt-get install -y -qq sqlite3 >/dev/null

write_status() {
  # $1 — результат выгрузки в облако, $2 — пояснение
  printf '{"at":"%s","offsite":"%s","note":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" > "$STATUS"
}

# Корректная копия базы SQLite без остановки приложения
if ! sqlite3 "$DATA_DIR/data.db" ".backup '$BACKUP_DIR/data_$STAMP.db'"; then
  write_status "error" "не удалось скопировать базу"
  echo "ОШИБКА: не удалось скопировать базу"; exit 1
fi
gzip -f "$BACKUP_DIR/data_$STAMP.db"

# Файлы сводок
if [ -d "$DATA_DIR/pbk_files" ]; then
  tar -czf "$BACKUP_DIR/files_$STAMP.tar.gz" -C "$DATA_DIR" pbk_files
fi

# Оставляем 30 последних копий каждого вида
ls -1t "$BACKUP_DIR"/data_*.db* 2>/dev/null | tail -n +31 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/files_*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
echo "Копия создана: $BACKUP_DIR/data_$STAMP.db.gz"

# ---------- выгрузка в облако по WebDAV (Яндекс Диск, Облако Mail.ru и др.) ----------
if [ ! -f "$CLOUD_ENV" ]; then
  write_status "не настроено" "копия только на этом сервере"
  du -sh "$BACKUP_DIR"; exit 0
fi
# shellcheck disable=SC1090
. "$CLOUD_ENV"
URL="${WEBDAV_URL%/}/pbk-backups"
AUTH="$WEBDAV_USER:$WEBDAV_PASS"
curl -s -m 60 -u "$AUTH" -X MKCOL "$URL/" -o /dev/null || true
ok=1
for f in "$BACKUP_DIR/data_$STAMP.db.gz:data_$DAY.db.gz" "$BACKUP_DIR/files_$STAMP.tar.gz:files_$DAY.tar.gz"; do
  src="${f%%:*}"; dst="${f##*:}"
  [ -f "$src" ] || continue
  code="$(curl -s -m 900 -u "$AUTH" -T "$src" -o /dev/null -w '%{http_code}' "$URL/$dst")"
  case "$code" in 200|201|204) echo "В облако: $dst" ;; *) ok=0; echo "ОШИБКА выгрузки $dst: код $code" ;; esac
done
if [ "$ok" = 1 ]; then write_status "ok" "выгружено в облако"; else write_status "ошибка выгрузки" "проверьте логин и пароль облака: sudo bash deploy/backup-cloud.sh"; fi
du -sh "$BACKUP_DIR"
