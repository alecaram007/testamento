#!/usr/bin/env node
// Demo di Testamento: la vita di un termostato, dalla nascita alla liberazione
// (port di src/demo.ps1). Il produttore lo aggiorna per un anno, poi fallisce.
// Diciotto mesi dopo l'ultimo aggiornamento, la sua ultima capsula si apre e il
// termostato diventa libero, senza che nessuno debba chiedere il permesso.
// Tutto avviene nella cartella mac/demo.
//
//   node demo.mjs            con la taratura vera: circa 22 s di quadrature
//   node demo.mjs --veloce   capsule piccole (o TESTAMENTO_DEMO_VELOCE=1): pochi secondi

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dec } from './lib/puro.mjs';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(QUI, 'bin', 'testamento.mjs');
const DEMO = path.join(QUI, 'demo');
const MARCATORE = path.join(DEMO, '.demo-testamento');
const CALDO = path.join(DEMO, 'caldo-3000');
const veloce = process.argv.includes('--veloce') || process.env.TESTAMENTO_DEMO_VELOCE === '1';

const colori = process.stdout.isTTY && !process.env.NO_COLOR;
const tinta = (codice, t) => (colori ? codice + t + '\x1b[0m' : t);

if (fs.existsSync(DEMO)) {
  if (!fs.existsSync(MARCATORE)) {
    console.error("La cartella '" + DEMO + "' esiste ma non l'ha creata la demo: non la tocco.");
    process.exit(1);
  }
  fs.rmSync(DEMO, { recursive: true, force: true });
}
fs.mkdirSync(DEMO, { recursive: true });
fs.writeFileSync(MARCATORE, 'Cartella generata da demo.mjs: viene ricreata a ogni esecuzione.\n');

const env = { ...process.env };
delete env.TESTAMENTO_QUADRATURE_AL_MESE;
delete env.TESTAMENTO_DISPOSITIVO;
if (veloce) env.TESTAMENTO_QUADRATURE_AL_MESE = '20000';

function virgolette(a) {
  if (a === '' || /[\s"]/.test(a)) return '"' + a.replace(/"/g, '\\"') + '"';
  return a;
}

// Esegue la riga di comando senza catturarne l'uscita, così la barra di avanzamento
// si aggiorna dal vivo. 'attesi' sono i codici di uscita previsti dalla storia
// (2 = rifiutato: codice scaduto o falso, installazione negata, capsula sigillata).
function testamento(argomenti, attesi = [0]) {
  console.log('');
  console.log(tinta('\x1b[90m', '  > testamento ' + argomenti.map(virgolette).join(' ')));
  const r = spawnSync(process.execPath, [BIN, ...argomenti, '--dispositivo', CALDO], { stdio: 'inherit', env });
  if (!attesi.includes(r.status)) {
    console.error("'testamento " + argomenti.join(' ') + "' è uscito con il codice " + r.status + ': la demo si ferma qui.');
    process.exit(1);
  }
}
function titolo(t) {
  console.log('');
  console.log('');
  console.log(tinta('\x1b[95m', '━━━ ' + t));
}
function racconto(t) {
  console.log(tinta('\x1b[36m', '  ' + t));
}
function codicePubblicato(n) {
  const f = path.join(CALDO, 'capsule', 'capsula-' + n + '.codice.txt');
  const m = /([0-9A-F]{4}-){7}[0-9A-F]{4}/.exec(fs.readFileSync(f, 'utf8'));
  if (!m) throw new Error('Nessun codice in ' + f);
  return m[0];
}

const inizio = performance.now();
if (veloce) racconto('(Modalità veloce: 1 mese = 20.000 quadrature, le capsule si aprono in pochi decimi di secondo.)');

// ---------------------------------------------------------------------------
// La storia
// ---------------------------------------------------------------------------
titolo('1 · Nasce il termostato «Caldo 3000», con il firmware v1.0');
racconto("Nella ROM di avvio c'è la regola del testamento. Nessun aggiornamento potrà cambiarla.");
testamento(['nasce', 'Caldo 3000']);

titolo('2 · Mese 6: il produttore rilascia la v1.1');
testamento(['tempo', '6']);
testamento(['aggiorna', '1.1']);

titolo('3 · Mese 12: arriva la v1.2');
testamento(['tempo', '6']);
testamento(['aggiorna', '1.2']);
testamento(['stato']);

titolo('4 · Un curioso vuole sbloccare il termostato subito. Prima tira a indovinare...');
testamento(['sblocca', '1234-5678-9ABC-DEF0-1234-5678-9ABC-DEF0'], [2]);
testamento(['indovina', '2']);

titolo('5 · ...poi prova ad aprire la capsula #1, la più vecchia: ha solo 12 mesi');
testamento(['apri', '1'], [2]);

titolo('6 · Mese 14: il produttore fallisce');
racconto('Nessun comando lo annuncia: il termostato non lo sa e non ha bisogno di saperlo.');
racconto('Semplicemente, da oggi non arriverà più nessun aggiornamento.');
testamento(['tempo', '2']);
racconto('Qualcuno prova subito a installare un firmware libero:');
testamento(['installa', 'FirmwareLibero 1.0'], [2]);

titolo('7 · Mese 18: la capsula #1 compie 18 mesi e il curioso finisce il calcolo');
testamento(['tempo', '4']);
testamento(['apri', '1']);
const codice1 = codicePubblicato(1);
testamento(['sblocca', codice1], [2]);

titolo('8 · Mese 32: da 20 mesi non arriva niente. La comunità apre la capsula #3');
testamento(['tempo', '14']);
testamento(['stato']);
testamento(['apri', '3']);
const codice3 = codicePubblicato(3);

titolo('9 · Il codice della capsula #3 è ancora valido: il bootloader si sblocca');
testamento(['sblocca', codice3]);

titolo('10 · La comunità installa FirmwareLibero 1.0');
testamento(['installa', 'FirmwareLibero 1.0']);
testamento(['stato']);

// ---------------------------------------------------------------------------
titolo('Fine');
const totale = (performance.now() - inizio) / 1000;
const secondi = {};
for (const n of [1, 3]) {
  secondi[n] = JSON.parse(fs.readFileSync(path.join(CALDO, 'capsule', 'capsula-' + n + '.lavoro.json'), 'utf8')).Secondi;
}
console.log(tinta('\x1b[92m', '  Il «Caldo 3000» è sopravvissuto al suo produttore.'));
console.log('  Quadrature sequenziali: capsula #1 ' + dec(secondi[1], 1) + ' s (in due riprese), capsula #3 ' + dec(secondi[3], 1) + ' s.');
console.log('  Durata totale della demo: ' + dec(totale, 1) + ' s.');
console.log('  I file del dispositivo sono in:  ' + CALDO);
console.log(tinta('\x1b[90m', '  (capsule/ con le capsule pubbliche e i codici aperti, certificato-di-liberazione.txt)'));
console.log('');
