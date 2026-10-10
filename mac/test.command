#!/bin/bash
# Testamento · tutti i test (node --test). Esce con 0 se sono tutti verdi.
cd "$(dirname "$0")" || exit 1
node --test
ESITO=$?
if [ -z "$TESTAMENTO_SENZA_PAUSA" ] && [ -t 0 ]; then
  read -r -p "  Premi Invio per chiudere..." _
fi
exit $ESITO
