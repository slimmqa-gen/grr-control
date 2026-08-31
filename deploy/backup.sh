#!/usr/bin/env bash
# Резервная копия базы данных и загруженных файлов.
# Запуск вручную:  bash deploy/backup.sh
# Копии складываются в /var/pbk-backups, хранятся 30 последних.
set -euo pipefail

DATA_DIR="/var/pbk-data"
BACKUP_DIR="/var/pbk-backups"
STAMP="$(date +%Y-%m-%d_%H-%M)"

mkdir -p "$BACKUP_DIR"

# Корректная копия базы SQLite без остановки приложения
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DATA_DIR/data.db" ".backup '$BACKUP_DIR/data_$STAMP.db'"
else
  apt-get install -y -qq sqlite3 >/dev/null
  sqlite3 "$DATA_DIR/data.db" ".backup '$BACKUP_DIR/data_$STAMP.db'"
fi

# Файлы сводок
if [ -d "$DATA_DIR/pbk_files" ]; then
  tar -czf "$BACKUP_DIR/files_$STAMP.tar.gz" -C "$DATA_DIR" pbk_files
fi

# Оставляем 30 последних копий каждого вида
ls -1t "$BACKUP_DIR"/data_*.db 2>/dev/null | tail -n +31 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/files_*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm -f

echo "Копия создана: $BACKUP_DIR/data_$STAMP.db"
du -sh "$BACKUP_DIR"
