#!/bin/bash
# Testamento · cruscotto web. Doppio clic: avvia il server e apre il browser.
# Per fermarlo: Ctrl+C in questa finestra (o chiudila).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "  Serve Node.js (versione 20 o successiva): https://nodejs.org"
  read -r -p "  Premi Invio per chiudere..." _
  exit 1
fi
PORTA="${PORT:-5177}"
export PORT="$PORTA"
node server.mjs &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
# aspetta che risponda proprio questo server (non un altro programma sulla stessa porta),
# poi apre il browser; se il server non parte, lo dice e non apre niente
PRONTO=
for _ in $(seq 1 50); do
  kill -0 $SERVER 2>/dev/null || break
  if curl -s "http://127.0.0.1:$PORTA/api/stato" | grep -q '"mesiAttesa"' && kill -0 $SERVER 2>/dev/null; then PRONTO=1; break; fi
  sleep 0.1
done
if [ -z "$PRONTO" ] && ! kill -0 $SERVER 2>/dev/null; then
  wait $SERVER
  echo "  Il cruscotto non è partito: il browser non viene aperto."
  if [ -t 0 ]; then read -r -p "  Premi Invio per chiudere..." _; fi
  exit 1
fi
open "http://localhost:$PORTA"
wait $SERVER
