// 3 · Compatibilità con la versione Windows, sui file veri della demo "Caldo 3000"
// creati da testamento.exe (../demo/caldo-3000, letti e mai modificati).
//
// - ogni file JSON, riletto e riscritto dal port, torna identico byte per byte;
// - le capsule reali si aprono con il ramo lento (circa un milione di quadrature ciascuna):
//   b coincide con la X salvata da Windows e il codice che esce ha l'impronta salata
//   registrata nella ROM di dispositivo.json. È la prova che il port è compatibile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_WINDOWS, T, cartellaDiProva } from './aiuto.mjs';
import { Json, SCHEMI, normalizza, serializza } from '../lib/dispositivo.mjs';
import { Capsula, PuzzleRsw, Codice } from '../lib/crittografia.mjs';
import { daBig, daByte, aByte } from '../lib/puro.mjs';

const presente = fs.existsSync(path.join(DEMO_WINDOWS, 'dispositivo.json'));
const opz = presente ? {} : { skip: 'la cartella demo/caldo-3000 della versione Windows non c\'è' };

const file = (r) => path.join(DEMO_WINDOWS, r);
const leggiTesto = (r) => fs.readFileSync(file(r), 'utf8');

test('i JSON di Windows, riletti e riscritti, tornano identici byte per byte', opz, () => {
  const casi = [
    ['dispositivo.json', SCHEMI.StatoDispositivo],
    ['capsule/capsula-1.json', SCHEMI.Capsula],
    ['capsule/capsula-2.json', SCHEMI.Capsula],
    ['capsule/capsula-3.json', SCHEMI.Capsula],
    ['capsule/capsula-1.lavoro.json', SCHEMI.LavoroCapsula],
    ['capsule/capsula-3.lavoro.json', SCHEMI.LavoroCapsula],
  ];
  for (const [r, schema] of casi) {
    const originale = leggiTesto(r);
    const riscritto = serializza(Json.leggi(file(r), schema)) + '\r\n';
    assert.equal(riscritto, originale, r);
  }
});

test('anche la taratura di Windows (bin/taratura.json) si rilegge e si riscrive uguale', () => {
  const f = path.resolve(DEMO_WINDOWS, '..', '..', 'bin', 'taratura.json');
  if (!fs.existsSync(f)) return;
  const originale = fs.readFileSync(f, 'utf8');
  const riscritto = serializza(normalizza(SCHEMI.Taratura, JSON.parse(originale))) + (originale.includes('\r\n') ? '\r\n' : '\n');
  assert.equal(riscritto.replace(/\r\n/g, '\n'), originale.replace(/\r\n/g, '\n'));
});

test('le stringhe sono protette come JavaScriptSerializer (< > \' & e controlli)', () => {
  assert.equal(serializza("L'altro <b> & \"x\"\n"), '"L\\u0027altro \\u003cb\\u003e \\u0026 \\"x\\"\\n"');
  assert.equal(serializza({ A: [], B: {}, C: null, D: 1.5 }), '{\r\n  "A": [],\r\n  "B": {},\r\n  "C": null,\r\n  "D": 1.5\r\n}');
});

const stato = presente ? JSON.parse(leggiTesto('dispositivo.json')) : null;

for (const n of [1, 2, 3]) {
  test(`capsula reale #${n}: ramo lento in Node, HMAC verificato, impronta uguale a quella della ROM`, opz, (t) => {
    const c = Capsula.da(Json.leggi(file(`capsule/capsula-${n}.json`), SCHEMI.Capsula));
    assert.equal(c.T, 1009800);
    assert.equal(c.BitModulo, 1024);
    const inizio = performance.now();
    const b = PuzzleRsw.risolviLento(c.baseA(), c.T, c.moduloN());
    const ms = performance.now() - inizio;
    t.diagnostic(`${c.T.toLocaleString('it-IT')} quadrature in ${Math.round(ms)} ms (${Math.round(c.T / ms * 1000).toLocaleString('it-IT')} al secondo)`);

    const lavoro = file(`capsule/capsula-${n}.lavoro.json`);
    if (fs.existsSync(lavoro)) assert.equal(daBig(b), JSON.parse(fs.readFileSync(lavoro, 'utf8')).X, 'b diverso dalla X di Windows');

    const codice = c.apri(b);                           // lancia se l'HMAC non torna
    const imp = stato.Rom.Codici[n - 1];
    assert.equal(daByte(Codice.impronta(aByte(imp.Sale), codice)), imp.Impronta);

    const pubblicato = file(`capsule/capsula-${n}.codice.txt`);
    if (fs.existsSync(pubblicato)) assert.ok(fs.readFileSync(pubblicato, 'utf8').includes(Codice.formatta(codice)));
  });
}

test('la riga di comando Mac legge la cartella di Windows (copiata): stato, apri, certificato', opz, () => {
  const copia = path.join(cartellaDiProva('compat'), 'caldo-3000');
  fs.cpSync(DEMO_WINDOWS, copia, { recursive: true });
  try {
    let o = T(copia, ['stato']);
    assert.equal(o.codice, 0, o.testo);
    assert.match(o.testo, /TESTAMENTO · «Caldo 3000» · mese 32 dalla nascita · giugno 2029/);
    assert.match(o.testo, /Stato\s+LIBERO/);
    assert.match(o.testo, /#1 {7}mese 0 {3}v1\.0 {6}mese 18 {3}aperta · scaduta \(poi è arrivato v1\.1\)/);
    assert.match(o.testo, /#2 {7}mese 6 {3}v1\.1 {6}mese 24 {3}sigillata · apribile ora \(codice scaduto\)/);
    assert.match(o.testo, /#3 {7}mese 12 {2}v1\.2 {6}mese 30 {3}aperta · valida: ha liberato il dispositivo/);

    o = T(copia, ['apri', '3']);
    assert.equal(o.codice, 0, o.testo);
    assert.match(o.testo, /Già aperta al mese 32 dopo 11,7 s di calcolo: rileggo il risultato salvato\./);
    assert.match(o.testo, /702C-680E-A05B-DF29-9346-F4A4-F28A-BF20/);

    o = T(copia, ['certificato']);
    assert.equal(o.codice, 0, o.testo);
    assert.match(o.testo, /Verifica: SHA-256\(sale \|\| codice #3\) coincide con l'impronta nella ROM\./);
    // il certificato di Windows non viene riscritto
    assert.equal(fs.readFileSync(path.join(copia, 'certificato-di-liberazione.txt'), 'utf8'),
      fs.readFileSync(file('certificato-di-liberazione.txt'), 'utf8'));
  } finally {
    fs.rmSync(path.dirname(copia), { recursive: true, force: true });
  }
});

test('certificato e codice pubblicato scritti dal Mac hanno il formato di Windows (BOM, CRLF)', opz, () => {
  const prove = cartellaDiProva('formato');
  const d = path.join(prove, 'caldo');
  try {
    T(d, ['nasce', 'Caldo 3000']);
    T(d, ['tempo', '18']);
    T(d, ['apri', '1']);
    const codice = /([0-9A-F]{4}-){7}[0-9A-F]{4}/.exec(fs.readFileSync(path.join(d, 'capsule', 'capsula-1.codice.txt'), 'utf8'))[0];
    assert.equal(T(d, ['sblocca', codice]).codice, 0);
    for (const [mac, win] of [['certificato-di-liberazione.txt', 'certificato-di-liberazione.txt'],
      ['capsule/capsula-1.codice.txt', 'capsule/capsula-1.codice.txt']]) {
      const m = fs.readFileSync(path.join(d, mac));
      const w = fs.readFileSync(file(win));
      assert.deepEqual([...m.subarray(0, 3)], [0xEF, 0xBB, 0xBF], mac + ': BOM');
      const tm = m.toString('utf8').split('\r\n');
      const tw = w.toString('utf8').split('\r\n');
      assert.equal(tm.length, tw.length, mac + ': stesse righe CRLF');
      assert.equal(tm[0], tw[0], mac + ': stessa prima riga');
      assert.equal(tm[tm.length - 1], tw[tw.length - 1], mac + ': stessa ultima riga');
      assert.equal(m.toString('utf8').replace(/\r\n/g, '').includes('\n'), false, mac + ': nessun LF da solo');
    }
    // dispositivo.json: CRLF, due spazi, nessun BOM, chiudi con CRLF
    const j = fs.readFileSync(path.join(d, 'dispositivo.json'), 'utf8');
    assert.ok(j.startsWith('{\r\n  "Formato": "testamento-dispositivo-1",\r\n  "Nome": "Caldo 3000",'));
    assert.ok(j.endsWith('\r\n}\r\n'));
  } finally {
    fs.rmSync(prove, { recursive: true, force: true });
  }
});
