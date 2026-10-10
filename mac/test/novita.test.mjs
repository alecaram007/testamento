// 4 · Le novità della versione Mac: limite ai tentativi di sblocca con attesa crescente,
// esportazione del certificato, modulo N da 2048 bit, taratura in mac/taratura.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { T, cartellaDiProva, leggiStato, codicePubblicato } from './aiuto.mjs';
import { esegui, CODICI_FALSI_LIBERI } from '../lib/comandi.mjs';
import { UscitaRaccolta } from '../lib/uscita.mjs';
import { Archivio } from '../lib/dispositivo.mjs';

const prove = cartellaDiProva('novita');
test.after(() => fs.rmSync(prove, { recursive: true, force: true }));

// esegue un comando nel processo, con un orologio finto
async function E(cartella, args, ora) {
  const uscita = new UscitaRaccolta();
  const codice = await esegui([...args, '--dispositivo', cartella], {
    uscita,
    env: { ...process.env, TESTAMENTO_QUADRATURE_AL_MESE: '50' },
    ora: ora ? () => ora.t : undefined,
  });
  return { codice, testo: uscita.testo() };
}

test('limite ai tentativi: dopo 5 codici falsi di fila l\'attesa raddoppia (1 s, 2 s, 4 s...)', async () => {
  const d = path.join(prove, 'tentativi');
  const ora = { t: Date.parse('2026-10-04T10:00:00Z') };
  assert.equal((await E(d, ['nasce', 'Prova tentativi'], ora)).codice, 0);
  const falso = '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';

  for (let i = 1; i < CODICI_FALSI_LIBERI; i++) {
    const o = await E(d, ['sblocca', falso], ora);
    assert.equal(o.codice, 2);
    assert.match(o.testo, /Codice rifiutato: non corrisponde/);
    assert.doesNotMatch(o.testo, /Codici falsi di fila/);           // i primi tentativi sono come nell'originale
  }
  let o = await E(d, ['sblocca', falso], ora);                      // il quinto
  assert.match(o.testo, /Codici falsi di fila: 5\. Prima del prossimo tentativo il dispositivo aspetta 1 secondo\./);

  o = await E(d, ['sblocca', falso], ora);                          // subito dopo: rifiutato senza controllare
  assert.equal(o.codice, 2);
  assert.match(o.testo, /Tentativo rifiutato senza controllare il codice: 5 codici falsi di fila\./);
  assert.doesNotMatch(o.testo, /calcola SHA-256/);

  ora.t += 1000;                                                    // passa 1 s: si può riprovare
  o = await E(d, ['sblocca', falso], ora);
  assert.match(o.testo, /Codici falsi di fila: 6\. .* aspetta 2 secondi\./);
  ora.t += 2000;
  o = await E(d, ['sblocca', falso], ora);
  assert.match(o.testo, /aspetta 4 secondi/);

  // un testo che non è un codice non conta e non viene bloccato
  o = await E(d, ['sblocca', 'ciao'], ora);
  assert.match(o.testo, /non è un codice di liberazione/);
  assert.equal(new Archivio(d).leggiTentativi().CodiciFalsiDiFila, 7);

  // il file tentativi.json non contiene codici, e dispositivo.json resta nel formato originale
  const tent = JSON.parse(fs.readFileSync(path.join(d, 'tentativi.json'), 'utf8'));
  assert.deepEqual(Object.keys(tent), ['CodiciFalsiDiFila', 'ProssimoTentativo']);
  assert.deepEqual(Object.keys(leggiStato(d)), ['Formato', 'Nome', 'AnnoNascita', 'MeseNascita', 'Mese', 'Firmware',
    'FirmwareUfficiale', 'MeseUltimoAggiornamento', 'Bootloader', 'MeseLiberazione', 'QuadratureAlMese',
    'QuadratureAlSecondo', 'Rom', 'Storia']);
});

test('limite ai tentativi: l\'attesa arriva al massimo a un\'ora e un codice valido azzera il conto', async () => {
  const d = path.join(prove, 'tentativi-2');
  const ora = { t: Date.parse('2026-10-04T10:00:00Z') };
  await E(d, ['nasce', 'Prova attesa'], ora);
  const a = new Archivio(d);
  a.salvaTentativi({ CodiciFalsiDiFila: 40, ProssimoTentativo: null });
  let o = await E(d, ['sblocca', '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF'], ora);
  assert.match(o.testo, /aspetta 60 minuti/);
  ora.t += 3600 * 1000;
  await E(d, ['tempo', '18'], ora);
  await E(d, ['apri', '1'], ora);
  o = await E(d, ['sblocca', codicePubblicato(d, 1)], ora);
  assert.equal(o.codice, 0, o.testo);
  assert.equal(a.leggiTentativi().CodiciFalsiDiFila, 0);
});

test('limite ai tentativi: i codici scaduti non contano, nemmeno dopo 4 codici falsi di fila', async () => {
  const d = path.join(prove, 'tentativi-scaduti');
  const ora = { t: Date.parse('2026-10-04T10:00:00Z') };
  await E(d, ['nasce', 'Prova scaduti'], ora);
  await E(d, ['tempo', '18'], ora);
  await E(d, ['apri', '1'], ora);
  await E(d, ['aggiorna', '1.1'], ora);
  const scaduto = codicePubblicato(d, 1);
  const falso = '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';
  for (let i = 1; i < CODICI_FALSI_LIBERI; i++) await E(d, ['sblocca', falso], ora);
  for (let i = 0; i < 10; i++) {
    const o = await E(d, ['sblocca', scaduto], ora);
    assert.equal(o.codice, 2);
    assert.match(o.testo, /Codice scaduto: .*\(v1\.0 → v1\.1\)/);
    assert.doesNotMatch(o.testo, /Codici falsi di fila|Tentativo rifiutato/);
  }
  assert.equal(new Archivio(d).leggiTentativi().CodiciFalsiDiFila, CODICI_FALSI_LIBERI - 1);
  assert.equal(new Archivio(d).leggiTentativi().ProssimoTentativo, null);
});

test('certificato: rifiutato prima della liberazione, poi esportato in .txt, .html e .json verificabili', () => {
  const d = path.join(prove, 'certificato');
  T(d, ['nasce', 'Caldo <3000> & co']);
  let o = T(d, ['certificato']);
  assert.equal(o.codice, 2);
  assert.match(o.testo, /non è ancora libero/);
  T(d, ['tempo', '1']);
  T(d, ['aggiorna', '1.1']);
  T(d, ['tempo', '18']);
  T(d, ['apri', '2']);
  assert.equal(T(d, ['sblocca', codicePubblicato(d, 2)]).codice, 0);

  o = T(d, ['certificato']);
  assert.equal(o.codice, 0, o.testo);
  assert.match(o.testo, /CERTIFICATO DI LIBERAZIONE/);
  assert.match(o.testo, /Verifica: SHA-256\(sale \|\| codice #2\) coincide con l'impronta nella ROM\./);
  const j = JSON.parse(fs.readFileSync(path.join(d, 'certificato-di-liberazione.json'), 'utf8'));
  assert.equal(j.Capsula, 2);
  assert.equal(j.ImprontaVerificata, true);
  assert.deepEqual(j.AggiornamentiRicevuti, ['v1.1']);
  assert.equal(j.Codice, codicePubblicato(d, 2));
  const h = fs.readFileSync(path.join(d, 'certificato-di-liberazione.html'), 'utf8');
  assert.match(h, /^<!doctype html>/);
  assert.match(h, /Caldo &lt;3000&gt; &amp; co/);                  // il nome è protetto nell'HTML
  assert.doesNotMatch(h, /<3000>/);
  // il nome con < > & nel JSON del dispositivo è scritto come JavaScriptSerializer
  assert.match(fs.readFileSync(path.join(d, 'dispositivo.json'), 'utf8'), /"Nome": "Caldo \\u003c3000\\u003e \\u0026 co"/);
});

test('certificato: se il .txt manca viene rigenerato com\'era il giorno della liberazione', () => {
  const d = path.join(prove, 'certificato-2');
  T(d, ['nasce', 'Rigenerato']);
  T(d, ['tempo', '20']);
  T(d, ['apri', '1']);
  T(d, ['sblocca', codicePubblicato(d, 1)]);
  const originale = fs.readFileSync(path.join(d, 'certificato-di-liberazione.txt'), 'utf8');
  fs.rmSync(path.join(d, 'certificato-di-liberazione.txt'));
  T(d, ['tempo', '5']);
  assert.equal(T(d, ['certificato']).codice, 0);
  assert.equal(fs.readFileSync(path.join(d, 'certificato-di-liberazione.txt'), 'utf8'), originale);
});

test('modulo N da 2048 bit: capsule da 2048 bit anche dopo gli aggiornamenti, e si aprono', () => {
  const d = path.join(prove, 'modulo-2048');
  let o = T(d, ['nasce', 'Grosso', '--bit', '2048']);
  assert.equal(o.codice, 0, o.testo);
  assert.match(o.testo, /N da 2048 bit/);
  T(d, ['aggiorna', '1.1']);
  for (const n of [1, 2]) {
    const c = JSON.parse(fs.readFileSync(path.join(d, 'capsule', 'capsula-' + n + '.json'), 'utf8'));
    assert.equal(c.BitModulo, 2048);
    assert.equal(c.N.length, 512);                                 // 256 byte in esadecimale
  }
  T(d, ['tempo', '18']);
  o = T(d, ['apri', '2']);
  assert.equal(o.codice, 0, o.testo);
  assert.equal(T(d, ['sblocca', codicePubblicato(d, 2)]).codice, 0);
});

test('modulo N: valori non ammessi sono un errore d\'uso, e vale anche TESTAMENTO_BIT_MODULO', () => {
  const d = path.join(prove, 'modulo-sbagliato');
  const o = T(d, ['nasce', 'X', '--bit', '512']);
  assert.equal(o.codice, 1);
  assert.match(o.testo, /Modulo non valido: '512'/);
  assert.equal(fs.existsSync(path.join(d, 'dispositivo.json')), false);
  const d2 = path.join(prove, 'modulo-env');
  assert.equal(T(d2, ['nasce', 'Y'], { TESTAMENTO_BIT_MODULO: '2048' }).codice, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d2, 'capsule', 'capsula-1.json'), 'utf8')).BitModulo, 2048);
});

test('taratura: misura e salva nel formato dell\'originale (qui in una cartella di prova)', () => {
  const cartella = path.join(prove, 'taratura');
  fs.mkdirSync(cartella);
  const env = { TESTAMENTO_CARTELLA_TARATURA: cartella };
  const o = T(path.join(prove, 'nessuno'), ['taratura'], env);
  assert.equal(o.codice, 0, o.testo);
  assert.match(o.testo, /quadrature al secondo · 1 mese simulato = [\d.]+ quadrature ≈ 0,6 s/);
  const t = JSON.parse(fs.readFileSync(path.join(cartella, 'taratura.json'), 'utf8'));
  assert.deepEqual(Object.keys(t), ['QuadratureAlSecondo', 'BitModulo', 'Misurata']);
  assert.ok(t.QuadratureAlSecondo > 10000);
  assert.equal(t.BitModulo, 1024);
  assert.match(t.Misurata, /^\d{1,2} [a-z]+ \d{4}, \d\d:\d\d$/);

  // nasce senza TESTAMENTO_QUADRATURE_AL_MESE usa la taratura salvata (verificata con una prova breve)
  const d = path.join(prove, 'con-taratura');
  const n = T(d, ['nasce', 'Tarato'], { ...env, TESTAMENTO_QUADRATURE_AL_MESE: '' });
  assert.equal(n.codice, 0, n.testo);
  assert.match(n.testo, /Taratura: questo PC fa [\d.]+ quadrature al secondo modulo N da 1024 bit/);
  const s = leggiStato(d);
  assert.equal(s.QuadratureAlSecondo > 0, true);
  // 1 mese simulato = 0,6 s di calcolo
  assert.ok(Math.abs(s.QuadratureAlMese / s.QuadratureAlSecondo - 0.6) < 0.001);
});

test('TESTAMENTO_QUADRATURE_AL_MESE non valida: errore d\'uso', () => {
  const o = T(path.join(prove, 'qpm'), ['nasce', 'Z'], { TESTAMENTO_QUADRATURE_AL_MESE: 'tante' });
  assert.equal(o.codice, 1);
  assert.match(o.testo, /TESTAMENTO_QUADRATURE_AL_MESE non valida: 'tante'/);
});

test('indovina: forza bruta vera con più fili, nessun codice trovato', async () => {
  const d = path.join(prove, 'indovina');
  await E(d, ['nasce', 'Bersaglio']);
  const o = await E(d, ['indovina', '0,5']);
  assert.equal(o.codice, 0, o.testo);
  assert.match(o.testo, /Provo a indovinare il codice #1 per 0,5 s, con \d+ processori logici in parallelo\.\.\./);
  assert.match(o.testo, /codici giusti trovati: 0/);
  assert.match(o.testo, /2\^128 = 340\.282\.366\.920\.938\.463\.463\.374\.607\.431\.768\.211\.456/);
});
