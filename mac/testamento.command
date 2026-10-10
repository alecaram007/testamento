#!/bin/bash
# Testamento · riga di comando. Doppio clic: apre un terminale in questa cartella
# con l'elenco dei comandi. Da terminale: ./testamento.command <comando> [argomenti]
# (come testamento.cmd dell'originale, con argomenti lavora nella cartella da cui lo chiami:
#  ./dispositivo e i percorsi relativi di --dispositivo partono da lì)
QUI="$(cd "$(dirname "$0")" && pwd)" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "  Serve Node.js (versione 20 o successiva): https://nodejs.org"
  exit 1
fi
if [ $# -gt 0 ]; then
  exec node "$QUI/bin/testamento.mjs" "$@"
fi
cd "$QUI" || exit 1
node bin/testamento.mjs aiuto
echo "  Sei nella cartella: $(pwd)"
echo "  Scrivi i comandi così:  node bin/testamento.mjs stato   (oppure ./testamento.command stato)"
echo ""
exec "${SHELL:-/bin/zsh}" -i
