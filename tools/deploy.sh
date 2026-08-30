#!/usr/bin/env sh
# Выкладка игры на aka-gst.ru/stealth/.
#
#   sh tools/deploy.sh                          проверить и показать, что уедет
#   sh tools/deploy.sh --deploy                 и выложить
#   GAME_PATH=... sh tools/deploy.sh --deploy   выложить по другому адресу
#
# Каталог игры живёт только на сервере: в дереве сайта его нет, и выкладывается
# он отсюда. Поэтому --delete здесь безопасен и нужен — он убирает остатки
# предыдущих сборок.
#
# Тесты гоняются до выкладки, живые адреса проверяются после. Выложить игру,
# в которой сломано правило, хуже, чем не выложить: сломанный стелс читается
# игроком как «игра врёт», и второй раз он не придёт.
set -eu

DEPLOY=no
[ "${1:-}" = "--deploy" ] && DEPLOY=yes
SSH_HOST="${SSH_HOST:-bonita}"
SITE_ROOT="${SITE_ROOT:-/opt/zakriva/caddy/site}"
GAME_PATH="${GAME_PATH:-stealth}"

HERE="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Сборка — не один файл: index.html грузит ./src/main.js как ES-модуль.
# Копируется дерево целиком, иначе на сервере будет белый экран.
# sfx входит в выкладку: без пака шаги остаются синтезом, а слух в этой
# игре — половина жанра. Помни, что rsync ниже идёт с --delete: забыть
# каталог в этом списке значит снести его с сервера.
SHIP="index.html src styles sfx"

echo "проверка правил"
npm test --silent >/dev/null 2>&1 || {
  echo "ОШИБКА: тесты не проходят, выкладка отменена" >&2
  exit 1
}

echo "проверка проходимости уровней"
node tools/check-level.mjs >/dev/null || {
  echo "ОШИБКА: какой-то уровень не проходится тихо, выкладка отменена" >&2
  exit 1
}

for entry in $SHIP; do
  [ -e "$HERE/$entry" ] || { echo "ОШИБКА: нет $entry" >&2; exit 1; }
  cp -R "$HERE/$entry" "$STAGE/"
done

# Из подкаталога свои файлы обязаны грузиться относительными путями.
grep -q 'src="\./src/main\.js' "$STAGE/index.html" || {
  echo "ОШИБКА: index.html не грузит ./src/main.js — проверь пути" >&2
  exit 1
}
grep -q 'href="\./styles/game\.css"' "$STAGE/index.html" || {
  echo "ОШИБКА: index.html не грузит ./styles/game.css — проверь пути" >&2
  exit 1
}

echo
echo "уедет в $SITE_ROOT/$GAME_PATH:"
( cd "$STAGE" && find . -type f | sort | sed 's|^\./|  |' )
echo "  итого: $(cd "$STAGE" && find . -type f | wc -l | tr -d ' ') файлов, $(du -sh "$STAGE" | cut -f1)"

[ "$DEPLOY" = yes ] || { echo; echo "это была проверка. для выкладки: sh tools/deploy.sh --deploy"; exit 0; }

echo
echo "выкладка на $SSH_HOST:$SITE_ROOT/$GAME_PATH"
REMOTE_SHELL="ssh -o BatchMode=yes -o ConnectTimeout=15"
if ! rsync -az --delete -e "$REMOTE_SHELL" "$STAGE/" "$SSH_HOST:$SITE_ROOT/$GAME_PATH/"; then
  echo "ОШИБКА: игра не выложена" >&2
  exit 1
fi

# Одна сетевая осечка не повод объявлять выкладку неудачной: файлы уже на
# сервере, и ложная «ОШИБКА» толкает перевыкладывать то, что и так на месте.
check() {
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "https://aka-gst.ru$1" || echo "нет ответа")
  [ "$code" = 200 ] && { echo "$code"; return; }
  sleep 2
  curl -s -o /dev/null -w "%{http_code}" --max-time 20 "https://aka-gst.ru$1" || echo "нет ответа"
}

failed=0
for path in "/$GAME_PATH/" "/$GAME_PATH/src/main.js" "/$GAME_PATH/src/world.js" \
            "/$GAME_PATH/src/levels.js" "/$GAME_PATH/styles/game.css"; do
  code=$(check "$path")
  printf "  %-28s %s\n" "$path" "$code"
  [ "$code" = 200 ] || failed=1
done
[ "$failed" = 0 ] || { echo "ОШИБКА: не все файлы отвечают 200" >&2; exit 1; }
echo
echo "готово: https://aka-gst.ru/$GAME_PATH/"
