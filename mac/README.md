# Testamento per Mac

**L'hardware che si libera da solo quando il produttore lo abbandona**, rifatto per macOS in Node.js puro, con in più un cruscotto web.

È lo stesso prototipo della versione Windows (vedi `../README.md` per la storia e per come funziona la crittografia): stessi comandi, stessi messaggi, stessi file su disco. Una cartella di un dispositivo creata su Windows si apre su Mac e viceversa. La crittografia è vera: primi da 512 bit con Miller-Rabin, puzzle a tempo di Rivest, Shamir e Wagner, AES-256-CBC e HMAC-SHA256.

Non serve installare niente oltre a **Node.js 20 o successivo** (provato con Node 24). Nessun pacchetto npm, nessuna rete: solo i moduli integrati di Node (`BigInt`, `node:crypto`, `node:http`, `node:worker_threads`).

## Provalo subito

| Doppio clic su | Che cosa fa |
|---|---|
| **`avvia.command`** | avvia il cruscotto web e apre il browser su `http://localhost:5177` |
| **`demo.command`** | la demo narrata del termostato «Caldo 3000» (circa 25 secondi) |
| **`testamento.command`** | apre un terminale in questa cartella con l'elenco dei comandi |
| **`test.command`** | tutti i test |

Se hai scaricato il progetto come ZIP, la prima volta macOS può chiedere conferma prima di aprire un file `.command`: tasto destro → **Apri** (sulle versioni più recenti: Impostazioni di Sistema → Privacy e sicurezza → **Apri comunque**). Con `git clone` di solito non succede.

Da terminale, nella cartella `mac`:

```
npm start                 il cruscotto web (oppure: node server.mjs)
npm test                  i test (oppure: node --test)
npm run demo              la demo (node demo.mjs --veloce la fa in pochi secondi)
node bin/testamento.mjs   la riga di comando
```

## Il cruscotto web

`avvia.command` (o `npm start`) avvia un piccolo server su `127.0.0.1:5177` (per cambiare porta: `PORT=8080 npm start`). Mostra:

- il dispositivo: firmware, bootloader **bloccato/sbloccato**, ultimo aggiornamento, stato del produttore e il conto alla rovescia dei 18 mesi;
- **la linea del tempo** in mesi: gli aggiornamenti, ogni capsula dalla nascita all'apertura, se il suo codice è valido o scaduto, il fallimento del produttore e «oggi»;
- i pulsanti per **far passare il tempo**, **rilasciare un aggiornamento**, **far fallire il produttore**, **aprire una capsula** (il server fa davvero le quadrature in un worker, e la barra di avanzamento arriva al browser con i Server-Sent Events; il calcolo si può **interrompere e riprendere**), **provare un codice** (con controllo del formato mentre scrivi), **tirare a indovinare** e **installare un firmware libero**;
- il **registro**, con lo stesso testo e gli stessi colori della riga di comando;
- una spiegazione breve per chi non sa di crittografia, e un approfondimento su tlock e drand.

Il cruscotto usa lo stesso nucleo della riga di comando (`lib/`) e una cartella dispositivo tutta sua, `mac/dispositivo-web`, che crea da solo (non è nel repository). Per usarne un'altra: `node server.mjs --dispositivo <cartella>` oppure la variabile `TESTAMENTO_WEB_DISPOSITIVO`. Il pulsante «Nuovo dispositivo» cancella solo una cartella creata dal cruscotto stesso.

Funziona offline, si adatta al telefono (da 375 px in su), segue il tema chiaro o scuro del Mac ed è usabile da tastiera.

## La riga di comando

Gli stessi comandi della versione Windows:

```
node bin/testamento.mjs nasce "Caldo 3000"          nuovo dispositivo: firmware v1.0, bootloader BLOCCATO, capsula #1
node bin/testamento.mjs aggiorna 1.1                il produttore rilascia un aggiornamento: la ROM ruota il codice
node bin/testamento.mjs tempo 6                     fa passare 6 mesi (simulati)
node bin/testamento.mjs stato                       firmware, bootloader, capsule e conto alla rovescia
node bin/testamento.mjs apri 3                      apre la capsula #3 facendo davvero le T quadrature
node bin/testamento.mjs sblocca 7F3A-19C2-...       prova un codice di liberazione
node bin/testamento.mjs installa "FirmwareLibero"   installa un firmware (solo a bootloader sbloccato)
node bin/testamento.mjs indovina 3                  3 secondi di forza bruta vera, per vedere quanto è inutile
node bin/testamento.mjs taratura                    rimisura la velocità di questo Mac
```

Se preferisci scrivere solo `testamento`: `./testamento.command stato`, oppure un alias nel tuo `~/.zshrc`:

```
alias testamento='node "/percorso/di/testamento/mac/bin/testamento.mjs"'
```

Ogni comando accetta `--dispositivo <cartella>` (oppure `-Dispositivo`, `-d`, `--dispositivo=<cartella>`). Se manca vale la variabile `TESTAMENTO_DISPOSITIVO`, altrimenti `./dispositivo`.

Codici di uscita: `0` riuscito, `1` errore d'uso, `2` rifiutato (codice scaduto o falso, installazione negata, capsula ancora sigillata), `3` capsula manomessa.

`TESTAMENTO_QUADRATURE_AL_MESE` imposta direttamente quante quadrature vale un mese (la usano i test).

### Il tempo sul Mac

Come su Windows, **1 mese simulato = 0,6 s di calcolo**. La taratura sta in `mac/taratura.json` (stesso formato di `bin\taratura.json`): si crea alla prima esecuzione e non è nel repository, perché dipende dal computer. Viene verificata con una prova di 0,3 s a ogni `nasce`: se la velocità cambia di più del 30%, si rimisura.

Su questo Mac (Apple M4, Node 24) `BigInt` fa circa **1,2 milioni di quadrature al secondo** modulo N da 1024 bit, quasi 13 volte il PC del prototipo Windows (93.500). Quindi una capsula da 18 mesi qui ha T ≈ 12,9 milioni di quadrature e si apre in circa 11 secondi, come sull'originale.

## Compatibilità con la versione Windows

I file su disco sono identici a quelli di `testamento.exe`, byte per byte:

- `dispositivo.json`, `capsule/capsula-N.json`, `capsule/capsula-N.lavoro.json`, `taratura.json`: il JSON di `JavaScriptSerializer` con la sua indentazione (due spazi, `"chiave": valore`, righe CRLF, UTF-8 senza BOM, stesso ordine dei campi, `< > ' &` scritti come `\u003c`, `\u003e`, `\u0027`, `\u0026`);
- i numeri grandi (N, a, x) e i byte (sale, impronte, IV, cifrato, HMAC) in **esadecimale maiuscolo big-endian**;
- la chiave è `SHA-256(b)` con b in big-endian su 128 byte (la lunghezza di N); l'HMAC copre `lunghezza dell'intestazione (4 byte little-endian) || intestazione || IV || cifrato`;
- `capsula-N.codice.txt` e `certificato-di-liberazione.txt` in UTF-8 **con** BOM e righe CRLF.

I test lo dimostrano sui file veri della demo Windows (`../demo/caldo-3000`, solo letti): ogni JSON riletto e riscritto torna identico, e **le tre capsule reali si aprono in Node con il ramo lento** (1.009.800 quadrature, circa 0,8 s ciascuna): `b` coincide con la `x` salvata da Windows, l'HMAC torna e il codice che esce ha esattamente l'impronta salata registrata nella ROM di `dispositivo.json`. Anche la capsula #2, che nella demo Windows nessuno aveva aperto.

## Novità rispetto alla versione Windows

1. **Il cruscotto web** descritto sopra, con avanzamento vero delle quadrature, interruzione e ripresa del calcolo e la possibilità di far fallire il produttore (registrata in `cruscotto.json`, un file che l'originale ignora).
2. **Limite ai tentativi di `sblocca` con attesa crescente.** I primi 4 codici falsi di fila si comportano come nell'originale. Dal quinto il dispositivo impone un'attesa che raddoppia a ogni errore (1 s, 2 s, 4 s… fino a un'ora) e, finché non è passata, rifiuta i tentativi senza nemmeno controllare il codice. Un testo che non è un codice e un codice scaduto non contano; la liberazione azzera il conto. Lo stato sta in `tentativi.json` (`CodiciFalsiDiFila`, `ProssimoTentativo`): nessun codice, e `dispositivo.json` resta nel formato originale.
3. **Esportazione del certificato**: `node bin/testamento.mjs certificato` (o i pulsanti del cruscotto) scrive accanto al `.txt` anche `certificato-di-liberazione.html`, da stampare, e `certificato-di-liberazione.json`. Contengono il sale, l'impronta della ROM e il codice pubblicato, e verificano che `SHA-256(sale || codice)` coincida con l'impronta: chiunque può rifare il controllo. Se il `.txt` manca, lo rigenera com'era il giorno della liberazione.
4. **Modulo N configurabile**: `nasce "<nome>" --bit 2048` (o `TESTAMENTO_BIT_MODULO=2048`) crea capsule con N da 2048 bit; gli aggiornamenti successivi usano lo stesso modulo, letto dalla capsula in vigore, quindi niente cambia nel formato dei file. Una quadratura da 2048 bit costa circa tre volte di più, perciò la taratura è a parte (`mac/taratura-2048.json`, `taratura 2048`) e 18 mesi restano circa 11 secondi.

E in più: `demo.mjs --veloce` (o `TESTAMENTO_DEMO_VELOCE=1`) per una demo di pochi secondi, `TESTAMENTO_SENZA_PAUSA=1` per saltare la pausa finale di `demo.command` e `test.command`, l'aiuto (`aiuto`) che elenca anche i comandi nuovi.

## Differenze dalla versione Windows

- **Percorsi**: i messaggi mostrano `capsule/capsula-1.json` invece di `capsule\capsula-1.json`, e la taratura è `mac/taratura.json` invece di `bin\taratura.json`. Tutti gli altri messaggi sono identici carattere per carattere, compresi numeri e date all'italiana (`1.009.800`, `11,6 s`, `ottobre 2026`) e la parola «PC» («questo PC fa…»), lasciata com'era perché gli esempi del README originale restino veri.
- **Colori**: codici ANSI nel Terminale al posto dei colori della console di Windows. Con l'uscita rediretta su file o pipe il testo è identico e senza colori, come l'originale; `NO_COLOR=1` li toglie sempre.
- **`indovina`** usa i worker di Node, uno per processore logico, invece dei thread .NET; sul Mac del port fa circa 5 milioni di tentativi al secondo.
- **Le demo non si sovrascrivono**: la demo Mac lavora in `mac/demo/caldo-3000`, quella Windows resta in `demo\caldo-3000`.
- **Niente compilazione**: non c'è un `build.cmd`; i `.command` sostituiscono i `.cmd`.

## I test

`npm test` (o `node --test`, o `test.command`): circa 90 verifiche in 5 secondi.

- `test/crittografia.test.mjs`: Miller-Rabin con il numero di Carmichael 561 e il primo di Mersenne 2^127-1; ramo veloce = ramo lento per T = 1, 2, 1.000, 20.000; calcolo interrotto e ripreso = tutto di seguito; la capsula restituisce il codice; l'HMAC rileva ogni manomissione (cifrato, HMAC, intestazione, IV, T, una quadratura in meno); formato e rilettura del codice; numeri e date all'italiana.
- `test/riga-di-comando.test.mjs`: la seconda parte di `test.ps1` sulla riga di comando vera: capsula sigillata prima del tempo e calcolo parziale al 27%, codice scaduto e codice falso rifiutati, `installa` rifiutato a bootloader bloccato, capsula alterata sul disco (`CAPSULA MANOMESSA`, uscita 3), nessun codice in chiaro nei file, liberazione completa, le opzioni per la cartella.
- `test/compatibilita.test.mjs`: i file veri della demo Windows (vedi sopra).
- `test/novita.test.mjs`: limite ai tentativi, certificato esportato, modulo da 2048 bit, taratura, `indovina`.
- `test/server.test.mjs`: pagine e API del cruscotto, avanzamento via SSE, calcolo interrotto e ripreso, protezioni.
- `test/revisione.test.mjs`: regressioni trovate in revisione (numeri decimali nei JSON scritti come `double.ToString("R")` di .NET, a capo Unicode protetti, `aggiorna` con una capsula rovinata).

## Com'è fatto

```
mac/
  bin/testamento.mjs        la riga di comando
  server.mjs                il server del cruscotto (node:http, nessuna dipendenza)
  demo.mjs                  la demo narrata
  lib/puro.mjs              esadecimale, BigInt, formato del codice, numeri all'italiana (usato anche dal browser)
  lib/crittografia.mjs      primi, puzzle RSW, AES + HMAC, capsula, codice
  lib/dispositivo.mjs       stato, ROM di avvio, archivio su disco, JSON compatibile
  lib/comandi.mjs           i comandi e il racconto a schermo (CLI, server e test)
  lib/taratura.mjs          la misura della velocità
  lib/cruscotto.mjs         lo stato del dispositivo per il web
  lib/apri-lavoratore.mjs   "apri" dentro un worker, con avanzamento e interruzione
  lib/indovina-lavoratore.mjs  un filo della forza bruta
  web/                      il cruscotto (HTML, CSS, JavaScript; nessuna CDN)
  test/                     i test (node --test)
  *.command                 i lanciatori per il doppio clic
```

## Limiti onesti

Valgono tutti i limiti della versione Windows (la ROM è simulata ed è un file modificabile, il limite dei 18 mesi lo impone il simulatore, la firma del produttore è simulata, gli aggiornamenti fantasma, chi non aggiorna si libera prima). In più:

- **RSW dipende dalla velocità, e qui si vede**: il Mac fa 13 volte le quadrature del PC del prototipo. Una capsula creata su Windows (T ≈ 1 milione) su questo Mac si apre in meno di un secondo invece di 11; una capsula creata qui, su un PC lento, impiegherebbe minuti. È proprio il motivo per cui un sistema vero userebbe tlock.
- **`BigInt` non è una libreria crittografica**: i calcoli non sono a tempo costante e i numeri non si possono azzerare in memoria (come i `BigInteger` di .NET). Va bene per un simulatore, non per un chip.
- **Il limite ai tentativi** usa l'orologio del Mac ed è in un file che chiunque può cancellare: come la ROM, qui è solo dichiarato. Con 2^128 codici possibili, comunque, non serve.
- **Il fallimento del produttore** esiste solo nel cruscotto web (`cruscotto.json`): la riga di comando, come l'originale, non ha un comando per annunciarlo, perché il dispositivo non ha bisogno di saperlo.
- **Il cruscotto è per una persona sola** su questo Mac: ascolta solo su `127.0.0.1`, non ha utenti né password, e un calcolo alla volta.
