#!/usr/bin/env bash
# Ключ сервера к закрытому (private) репозиторию GitHub — чтобы update.sh
# продолжал забирать обновления, когда код станет недоступен посторонним.
#
#   sudo bash deploy/repo-key.sh
#
# Первый запуск: создаёт ключ и печатает его ОТКРЫТУЮ часть (строка ssh-ed25519 ...).
#   Это не пароль — её можно прислать в чат, она только для чтения кода.
# Второй запуск (после того как ключ добавлен в GitHub): проверяет доступ и
#   переключает сервер на этот ключ.
set -euo pipefail
REPO="git@github.com:slimmqa-gen/grr-control.git"
KEY="/root/.ssh/pbk_deploy"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "запускайте от root: sudo bash deploy/repo-key.sh"; exit 1; }

mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -N "" -C "pbk-control-server" -f "$KEY" >/dev/null
fi
SSHCMD="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

if GIT_SSH_COMMAND="$SSHCMD" git ls-remote "$REPO" HEAD >/dev/null 2>&1; then
  git -C "$APP_DIR" config core.sshCommand "$SSHCMD"
  git -C "$APP_DIR" remote set-url origin "$REPO"
  echo "ГОТОВО: сервер забирает обновления по ключу. Репозиторий можно делать закрытым."
  echo "Проверка: cd $APP_DIR && sudo bash deploy/update.sh --dry-run"
else
  echo "Ключ ещё не добавлен в GitHub. Пришлите эту строку целиком:"
  echo
  cat "$KEY.pub"
  echo
  echo "После добавления запустите ещё раз: sudo bash deploy/repo-key.sh"
fi
