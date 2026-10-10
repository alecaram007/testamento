// 2 · Riga di comando (port della seconda parte di src/test.ps1), su un dispositivo
// di prova con T piccoli: 1 mese = 50 quadrature. I passi sono in sequenza, come nell'originale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { T, BIN, MAC, cartellaDiProva, leggiStato, codicePubblicato, altera } from './aiuto.mjs';

const prove = cartellaDiProva('cli');
const disp = path.join(prove, 'termostato');
const t = (...args) => T(disp, args);

test('riga di comando: la vita di un termostato di prova', async (s) => {
  let o;
  let st;
  let c1;
  let c3;

  await s.test('senza argomenti stampa l\'aiuto (uscita 0)', () => {
    const r = T(disp, []);
    // T aggiunge --dispositivo: senza comando resta l'aiuto
    assert.equal(r.codice, 0);
    assert.match(r.testo, /testamento nasce "<nome>"/);
  });

  await s.test('nasce: firmware v1.0, bootloader BLOCCATO, capsula #1', () => {
    o = t('nasce', 'Termostato di prova');
    st = leggiStato(disp);
    assert.equal(o.codice, 0, o.testo);
    assert.equal(st.Firmware, 'v1.0');
    assert.equal(st.Bootloader, 'BLOCCATO');
    assert.ok(fs.existsSync(path.join(disp, 'capsule', 'capsula-1.json')));
    assert.match(o.testo, /T = 900 quadrature = 18 mesi di calcolo/);
    assert.match(o.testo, /pubblicata in capsule\/capsula-1\.json/);
  });

  await s.test('nasce due volte nella stessa cartella: errore', () => {
    o = t('nasce', 'Un altro');
    assert.equal(o.codice, 1);
    assert.match(o.testo, /esiste già un dispositivo \(«Termostato di prova»\)/);
  });

  await s.test('comando sconosciuto, mesi non validi, capsula che non esiste: errore d\'uso (1)', () => {
    assert.equal(t('vola').codice, 1);
    assert.equal(t('tempo', 'tanti').codice, 1);
    assert.equal(t('tempo', '1201').codice, 1);
    o = t('apri', '9');
    assert.equal(o.codice, 1);
    assert.match(o.testo, /La capsula #9 non esiste\. Questo dispositivo ne ha 1 \(da 1 a 1\)\./);
  });

  await s.test('installa a bootloader bloccato: rifiutato', () => {
    o = t('installa', 'FirmwareLibero 1.0');
    st = leggiStato(disp);
    assert.equal(o.codice, 2, o.testo);
    assert.match(o.testo, /rifiutata/);
    assert.equal(st.Firmware, 'v1.0');
  });

  await s.test('apri al mese 5: capsula ancora sigillata, nessun codice', () => {
    t('tempo', '5');
    o = t('apri', '1');
    assert.equal(o.codice, 2, o.testo);
    assert.match(o.testo, /Ancora sigillata/);
    assert.equal(codicePubblicato(disp, 1), null);
  });

  await s.test('stato mostra il calcolo parziale salvato', () => {
    o = t('stato');
    assert.match(o.testo, /calcolo al 27%/, o.testo);
  });

  await s.test('apri al mese 18: il calcolo riprende e la capsula #1 si apre', () => {
    t('tempo', '13');
    o = t('apri', '1');
    c1 = codicePubblicato(disp, 1);
    assert.equal(o.codice, 0, o.testo);
    assert.ok(c1);
    assert.ok(o.testo.includes(c1));
    assert.match(o.testo, /Riprendo il calcolo salvato: 250 quadrature già fatte \(27%\)\./);
  });

  await s.test('aggiorna 1.1: capsula #2, il codice #1 scade', () => {
    o = t('aggiorna', '1.1');
    st = leggiStato(disp);
    assert.equal(o.codice, 0, o.testo);
    assert.equal(st.Rom.CodiceInVigore, 2);
    assert.equal(st.Rom.Codici[0].MeseScadenza, 18);
    assert.ok(fs.existsSync(path.join(disp, 'capsule', 'capsula-2.json')));
    assert.match(o.testo, /Nota: la capsula #1 era già matura/);
  });

  await s.test('codice scaduto rifiutato: "(v1.0 → v1.1)", bootloader ancora bloccato', () => {
    o = t('sblocca', c1);
    st = leggiStato(disp);
    assert.equal(o.codice, 2, o.testo);
    assert.ok(o.testo.includes('Codice scaduto'));
    assert.ok(o.testo.includes('(v1.0 → v1.1)'));
    assert.equal(st.Bootloader, 'BLOCCATO');
  });

  await s.test('codice falso rifiutato (e spiegazione dei 2^128 tentativi)', () => {
    let falso = '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';
    if (c1 === falso) falso = 'FEDC-BA98-7654-3210-FEDC-BA98-7654-3210';
    o = t('sblocca', falso);
    st = leggiStato(disp);
    assert.equal(o.codice, 2, o.testo);
    assert.match(o.testo, /Codice rifiutato/);
    assert.match(o.testo, /2\^128/);
    assert.equal(st.Bootloader, 'BLOCCATO');
  });

  await s.test('testo che non è un codice: rifiutato', () => {
    o = t('sblocca', 'ciao');
    assert.equal(o.codice, 2, o.testo);
    assert.match(o.testo, /non è un codice/);
  });

  await s.test('dopo un altro aggiornamento il codice #1 è ancora scaduto: "(v1.0 → v1.2)"', () => {
    t('aggiorna', '1.2');
    o = t('sblocca', c1);
    assert.equal(o.codice, 2, o.testo);
    assert.ok(o.testo.includes('(v1.0 → v1.2)'));
  });

  await s.test('aggiornare alla versione già installata è un errore d\'uso', () => {
    o = t('aggiorna', 'v1.2');
    assert.equal(o.codice, 1);
    assert.match(o.testo, /Il firmware v1\.2 è già installato\./);
  });

  await s.test("nei file del dispositivo il codice #1 non compare in chiaro (solo l'impronta)", () => {
    let tutto = '';
    const visita = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) visita(p);
        else if (!f.name.endsWith('.codice.txt')) tutto += fs.readFileSync(p, 'utf8');
      }
    };
    visita(disp);
    assert.equal(tutto.includes(c1.replaceAll('-', '')), false);
    assert.equal(tutto.includes(c1), false);
  });

  await s.test('apri una capsula manomessa sul disco: "CAPSULA MANOMESSA", nessun codice', () => {
    const f3 = path.join(disp, 'capsule', 'capsula-3.json');
    const originale3 = fs.readFileSync(f3, 'utf8');
    const j = JSON.parse(originale3);
    fs.writeFileSync(f3, originale3.replace(j.Cifrato, altera(j.Cifrato)));
    t('tempo', '18');
    o = t('apri', '3');
    assert.equal(o.codice, 3, o.testo);
    assert.match(o.testo, /CAPSULA MANOMESSA/);
    assert.equal(codicePubblicato(disp, 3), null);
    fs.writeFileSync(f3, originale3);
  });

  await s.test('capsula #3 ripristinata: si apre (il calcolo salvato era giusto)', () => {
    o = t('apri', '3');
    c3 = codicePubblicato(disp, 3);
    assert.equal(o.codice, 0, o.testo);
    assert.ok(c3);
  });

  await s.test('codice in vigore: bootloader SBLOCCATO e certificato di liberazione', () => {
    o = t('sblocca', c3);
    st = leggiStato(disp);
    assert.equal(o.codice, 0, o.testo);
    assert.equal(st.Bootloader, 'SBLOCCATO');
    assert.equal(st.Rom.Liberato, true);
    assert.ok(fs.existsSync(path.join(disp, 'certificato-di-liberazione.txt')));
    assert.match(o.testo, /CERTIFICATO DI LIBERAZIONE/);
    assert.match(o.testo, /Aggiornamenti ricevuti {6}2 \(v1\.1, v1\.2\)/);
  });

  await s.test('dopo la liberazione: aggiorna rifiutato (2), sblocca dice che è già libero (0)', () => {
    assert.equal(t('aggiorna', '1.3').codice, 2);
    o = t('sblocca', c3);
    assert.equal(o.codice, 0);
    assert.match(o.testo, /è già libero dal mese 36/);
  });

  await s.test('installa a bootloader sbloccato: FirmwareLibero 1.0', () => {
    o = t('installa', 'FirmwareLibero 1.0');
    st = leggiStato(disp);
    assert.equal(o.codice, 0, o.testo);
    assert.equal(st.Firmware, 'FirmwareLibero 1.0');
    assert.equal(st.FirmwareUfficiale, false);
  });

  await s.test('stato finale: LIBERO', () => {
    o = t('stato');
    assert.equal(o.codice, 0, o.testo);
    assert.match(o.testo, /Stato\s+LIBERO/);
    assert.match(o.testo, /aperta · valida: ha liberato il dispositivo/);
  });

  await s.test('opzioni equivalenti: -Dispositivo, --dispositivo=, TESTAMENTO_DISPOSITIVO', () => {
    const base = { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } };
    const bin = BIN;
    const a = spawnSync(process.execPath, [bin, 'stato', '-Dispositivo', disp], base);
    const b = spawnSync(process.execPath, [bin, 'stato', '--dispositivo=' + disp], base);
    const c = spawnSync(process.execPath, [bin, 'stato'], { ...base, env: { ...base.env, TESTAMENTO_DISPOSITIVO: disp } });
    assert.equal(a.status, 0);
    assert.equal(a.stdout, b.stdout);
    assert.equal(a.stdout, c.stdout);
  });
});

test('testamento.command con argomenti lavora nella cartella da cui lo si chiama (come testamento.cmd)', () => {
  // prima faceva cd nella cartella mac/: «-d rel» e ./dispositivo finivano dentro mac/
  const lanciatore = path.join(MAC, 'testamento.command');
  const qui = path.join(prove, 'chiamato da qui');
  fs.mkdirSync(qui, { recursive: true });
  const env = { ...process.env, TESTAMENTO_QUADRATURE_AL_MESE: '50', NO_COLOR: '1' };
  delete env.TESTAMENTO_DISPOSITIVO;
  const r = spawnSync('/bin/bash', [lanciatore, 'nasce', 'Relativo', '-d', 'rel-disp'], { cwd: qui, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(qui, 'rel-disp', 'dispositivo.json')));
  assert.ok(!fs.existsSync(path.join(MAC, 'rel-disp')));
  const s = spawnSync('/bin/bash', [lanciatore, 'stato'], { cwd: path.join(qui, 'rel-disp', '..'), encoding: 'utf8', env: { ...env, TESTAMENTO_DISPOSITIVO: 'rel-disp' } });
  assert.equal(s.status, 0, s.stdout + s.stderr);
  const e = spawnSync('/bin/bash', [lanciatore, 'apri', '9', '-d', 'rel-disp'], { cwd: qui, encoding: 'utf8', env });
  assert.equal(e.status, 1);                                        // il codice di uscita passa attraverso il lanciatore
});

test.after(() => fs.rmSync(prove, { recursive: true, force: true }));
