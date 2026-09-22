#!/usr/bin/env bash
# Обновление приложения после изменений в коде.
#
# Запускается на сервере из папки проекта от root:
#   sudo bash deploy/update.sh
#
# Сначала проверка без изменений (ничего не ставит, только смотрит готовность):
#   bash deploy/update.sh --dry-run
#
# Что делает скрипт:
#   1. проверяет окружение (root, служба, чистота репозитория, место на диске, память);
#   2. делает резервную копию базы и загруженных файлов;
#   3. забирает код из GitHub, ставит зависимости, собирает;
#   4. перезапускает службу и ждёт ответа приложения;
#   5. при неудаче возвращает прежнюю сборку и печатает команду откат кода.
#
# База данных и загруженные сводки в DATA_DIR не затрагиваются.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${SERVICE:-pbk-control}"
PORT="${PORT:-5000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/auth/demo-users"
BRANCH="${BRANCH:-main}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

cd "$APP_DIR"

say()  { echo "$*"; }
warn() { echo "ВНИМАНИЕ: $*"; }
die()  { echo "ОШИБКА: $*" >&2; exit 1; }

# ---------- Проверки до любых изменений ----------
say "=============================================="
say " Обновление ${SERVICE}"
say " Папка проекта: ${APP_DIR}"
[ "$DRY_RUN" = 1 ] && say " Режим: только проверка, изменений не будет"
say "=============================================="
say ""

if [ "$(id -u)" -ne 0 ]; then
  if [ "$DRY_RUN" = 1 ]; then
    warn "запущено не от root — перезапуск службы будет недоступен. Для установки: sudo bash deploy/update.sh"
  else
    die "запускайте от root. Выполните: sudo bash deploy/update.sh"
  fi
fi

command -v git >/dev/null 2>&1 || die "не найден git"
command -v npm >/dev/null 2>&1 || die "не найден npm"
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')" || true
[ -n "${NODE_MAJOR:-}" ] || die "не найден node"
[ "$NODE_MAJOR" -ge 20 ] || die "нужен Node.js 20 и новее, установлен $(node -v)"
say "Node.js $(node -v), npm $(npm -v)"

if ! systemctl list-unit-files "${SERVICE}.service" --no-legend | grep -q "${SERVICE}.service"; then
  die "служба ${SERVICE} не найдена. Проверьте: systemctl list-units | grep pbk"
fi

# Папка данных берётся из настроек службы, чтобы не перепутать базу
DATA_DIR="$(systemctl show -p Environment "$SERVICE" 2>/dev/null | tr ' ' '\n' | sed -n 's/^DATA_DIR=//p' | head -1)"
DATA_DIR="${DATA_DIR:-/var/pbk-data}"
say "Папка данных: ${DATA_DIR}"
[ -d "$DATA_DIR" ] || warn "папка данных ${DATA_DIR} не найдена — база будет создана заново при старте"

# Правки в файлах проекта останавливают обновление: git pull их затрёт или
# упрётся в конфликт. Посторонние файлы, которых нет в репозитории (копии вида
# routes.ts.backup), обновлению не мешают — о них только предупреждаем.
UNTRACKED="$(git ls-files --others --exclude-standard)"
if [ -n "$UNTRACKED" ]; then
  say ""
  warn "в папке проекта есть посторонние файлы (обновлению не мешают):"
  printf '  %s\n' $UNTRACKED
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  say ""
  say "Изменённые файлы проекта:"
  git status --short --untracked-files=no
  say ""
  say "Сохранить их:  git stash"
  say "Отказаться:    git checkout -- ."
  die "рабочая копия не чистая — обновление остановлено, чтобы не потерять правки"
fi

git fetch --quiet origin "$BRANCH" || die "не удалось связаться с GitHub"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/${BRANCH}")"
BASE="$(git merge-base HEAD "origin/${BRANCH}")"
if [ "$LOCAL" = "$REMOTE" ]; then
  say "Код уже актуален (${LOCAL:0:7}) — обновлять нечего."
elif [ "$BASE" != "$LOCAL" ]; then
  die "ветка разошлась с origin/${BRANCH} — обновление вручную: git log --oneline HEAD..origin/${BRANCH}"
else
  say "Будет установлено коммитов: $(git rev-list --count HEAD.."origin/${BRANCH}")"
  git --no-pager log --oneline HEAD.."origin/${BRANCH}" | head -10
fi

# Сборка удаляет папку dist, поэтому нужны место и память
FREE_MB="$(df -Pm "$APP_DIR" | awk 'NR==2 {print $4}')"
[ "$FREE_MB" -ge 1500 ] || warn "на диске свободно ${FREE_MB} МБ — для установки зависимостей и сборки желательно от 1500 МБ"
TOTAL_RAM="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
SWAP_MB="$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$TOTAL_RAM" -lt 1800 ] && [ "$SWAP_MB" -lt 512 ]; then
  warn "памяти ${TOTAL_RAM} МБ без файла подкачки — сборка может быть прервана системой. Подкачка на 2 ГБ: fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
fi

if [ "$DRY_RUN" = 1 ]; then
  say ""
  say "Проверка закончена. Изменений не вносилось."
  say "Установка: sudo bash deploy/update.sh"
  exit 0
fi

# ---------- Установка ----------
say ""
say "[1/6] Резервная копия базы и файлов..."
if [ -x "$APP_DIR/deploy/backup.sh" ] || [ -f "$APP_DIR/deploy/backup.sh" ]; then
  bash "$APP_DIR/deploy/backup.sh" || warn "резервная копия не создана — продолжаю, но откат базы будет невозможен"
else
  warn "deploy/backup.sh не найден — копия не создана"
fi

say ""
say "[2/6] Забираю обновления из GitHub..."
git pull --ff-only origin "$BRANCH"
NEW_COMMIT="$(git rev-parse --short HEAD)"
say "Текущий коммит: ${NEW_COMMIT} (прежний ${LOCAL:0:7})"

say ""
say "[3/6] Проверяю зависимости..."
# --include=dev обязателен: vite и esbuild лежат в devDependencies,
# а при NODE_ENV=production npm по умолчанию их пропускает и сборка падает
NODE_ENV=development npm install --no-audit --no-fund --include=dev

say ""
say "[4/6] Собираю приложение..."
# Сборка первым делом удаляет dist, поэтому сохраняем прежнюю рабочую версию
rm -rf dist.prev
if [ -d dist ]; then cp -a dist dist.prev; fi
if ! npm run build; then
  if [ -d dist.prev ]; then
    rm -rf dist && mv dist.prev dist
    warn "сборка не удалась — прежняя версия восстановлена, служба не перезапускалась"
  else
    warn "сборка не удалась, прежней сборки не было"
  fi
  say "Откат кода: git reset --hard ${LOCAL:0:7}"
  exit 1
fi

say ""
say "[5/6] Перезапускаю службу..."
systemctl restart "$SERVICE"

say ""
say "[6/6] Проверяю, что приложение отвечает..."
OK=0
for _ in $(seq 1 20); do
  sleep 2
  systemctl is-active --quiet "$SERVICE" || continue
  if curl -fsS -m 5 -o /dev/null "$HEALTH_URL"; then OK=1; break; fi
done

say ""
if [ "$OK" = 1 ]; then
  rm -rf dist.prev
  say "=============================================="
  say " ГОТОВО. Версия ${NEW_COMMIT} работает и отвечает на порту ${PORT}."
  say " База данных и загруженные файлы не тронуты."
  say "=============================================="
  exit 0
fi

warn "приложение не отвечает после обновления."
say ""
say "Последние строки журнала:"
journalctl -u "$SERVICE" -n 40 --no-pager || true
say ""
say "Вернуть прежнюю версию кода и собрать её заново:"
say "  git reset --hard ${LOCAL:0:7} && npm run build && systemctl restart ${SERVICE}"
say "Копии базы: /var/pbk-backups"
exit 1
