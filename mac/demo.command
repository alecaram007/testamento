#!/bin/bash
# Testamento · la demo narrata del termostato «Caldo 3000» (circa 25 secondi).
# ./demo.command --veloce  la fa in pochi secondi; TESTAMENTO_SENZA_PAUSA=1 salta la pausa finale.
cd "$(dirname "$0")" || exit 1
node demo.mjs "$@"
ESITO=$?
if [ -z "$TESTAMENTO_SENZA_PAUSA" ] && [ -t 0 ]; then
  read -r -p "  Premi Invio per chiudere..." _
fi
exit $ESITO
