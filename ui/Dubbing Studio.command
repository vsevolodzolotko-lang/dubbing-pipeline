#!/bin/bash
# Double-click this in Finder to launch Dubbing Studio. Self-installing,
# self-recovering. Closing the window stops the app.
set -u
cd "$(dirname "$0")" || exit 1

say() { printf "\n\033[1m%s\033[0m\n" "$1"; }

# 1. Node present?
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js не знайдено. Встанови його з https://nodejs.org (версія 20 або новіша), потім запусти знову." buttons {"OK"} default button 1' 2>/dev/null
  echo "Node.js not found — install from https://nodejs.org (>=20)."
  read -r -p "Press Enter to close."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  say "Node $NODE_MAJOR застарілий — потрібен 20+. Спробую все одно…"
fi

# 2. Install deps if missing
if [ ! -d node_modules ]; then
  say "Перший запуск — встановлюю залежності (раз)…"
  npm ci || npm install || { read -r -p "Install failed. Enter to close."; exit 1; }
fi

# 3. Build client if missing
if [ ! -d client/dist ]; then
  say "Збираю інтерфейс…"
  npm run build || { read -r -p "Build failed. Enter to close."; exit 1; }
fi

# 4. Open browser shortly after start
( sleep 2; open "http://127.0.0.1:${PORT:-8787}" ) &

# 5. Supervise: restart on crash, up to 5 times
say "Запускаю Dubbing Studio… (закрий це вікно, щоб зупинити)"
tries=0
while [ "$tries" -lt 5 ]; do
  npm start
  code=$?
  [ "$code" -eq 0 ] && break
  tries=$((tries + 1))
  say "Сервер зупинився (код $code). Перезапуск $tries/5 за 2с…"
  sleep 2
done

say "Зупинено."
read -r -p "Enter, щоб закрити вікно."
