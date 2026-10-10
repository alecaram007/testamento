// 5 · Il server del cruscotto web: pagine statiche, API JSON, avanzamento via
// Server-Sent Events, calcolo interrotto e ripreso, protezioni di base.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { creaServer } from '../server.mjs';
import { cartellaDiProva } from './aiuto.mjs';

const prove = cartellaDiProva('server');
const cartella = path.join(prove, 'dispositivo-web');
// 1 mese = 100.000 quadrature: una capsula da 18 mesi dura circa 1,5 s
const server = creaServer({ cartella, env: { TESTAMENTO_QUADRATURE_AL_MESE: '100000' } });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = 'http://127.0.0.1:' + server.address().port;

test.after(async () => {
  await server.chiudiTutto();
  fs.rmSync(prove, { recursive: true, force: true });
});

const post = async (via, corpo = {}) => {
  const r = await fetch(base + via, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  return { stato: r.status, dati: await r.json() };
};
const getStato = async () => (await fetch(base + '/api/stato')).json();
const testoRighe = (righe) => righe.map((r) => r.map((p) => p.testo).join('')).join('\n');

// Legge gli eventi SSE finché 'fino' non dice basta.
async function eventi(fino, limiteMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), limiteMs);
  const r = await fetch(base + '/api/eventi', { signal: ctrl.signal });
  const lettore = r.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  const visti = [];
  try {
    for (;;) {
      const { value, done } = await lettore.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const blocco = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(blocco);
        const da = /^data: (.*)$/m.exec(blocco);
        if (ev && da) {
          visti.push({ evento: ev[1], dati: JSON.parse(da[1]) });
          if (fino(visti)) return visti;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  return visti;
}

test('pagine statiche: index, stile, script, puro.mjs condiviso con il browser', async () => {
  for (const [via, tipo] of [['/', 'text/html'], ['/stile.css', 'text/css'], ['/app.mjs', 'text/javascript'], ['/lib/puro.mjs', 'text/javascript'], ['/icona.svg', 'image/svg+xml']]) {
    const r = await fetch(base + via);
    assert.equal(r.status, 200, via);
    assert.ok(r.headers.get('content-type').startsWith(tipo), via);
  }
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<html lang="it">/);
  assert.match(html, /Fai passare il tempo/);
  assert.equal((await fetch(base + '/lib/comandi.mjs')).status, 404);    // il resto del nucleo non si serve
  assert.notEqual((await fetch(base + '/%2e%2e/server.mjs')).status, 200);
});

test('protezioni: niente POST senza JSON, niente Host estranei', async () => {
  const r = await fetch(base + '/api/tempo', { method: 'POST', body: 'mesi=3' });
  assert.equal(r.status, 403);
  const r2 = await fetch(base + '/api/tempo', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://cattivo.example' }, body: '{}' });
  assert.equal(r2.status, 403);
});

test('richieste malformate: risposte 4xx pulite, niente errori interni né percorsi del server', async () => {
  const pj = (via, corpo) => fetch(base + via, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
  // JSON valido ma non un oggetto: prima dava 500 con «Cannot read properties of null»
  for (const corpo of ['null', '[1,2]', '5', '"testo"']) {
    const r = await pj('/api/nasce', corpo);
    assert.equal(r.status, 400, corpo);
    assert.doesNotMatch((await r.json()).errore, /Cannot read|undefined/);
  }
  // corpo troppo grande: il client riceve davvero un 413 (prima la connessione veniva troncata)
  const r = await pj('/api/tempo', JSON.stringify({ mesi: '1'.repeat(200 * 1024) }));
  assert.equal(r.status, 413);
  assert.match((await r.json()).errore, /troppo grande/);
  // percorsi con byte nulli o %-codifica rotta: 400, senza mostrare dove sta il server
  for (const via of ['/index.html%00.css', '/%E0%A4%A']) {
    const g = await fetch(base + via);
    assert.equal(g.status, 400, via);
    assert.doesNotMatch(await g.text(), /\/web\/|Users|URI malformed/);
  }
  // un errore d'uso (nessun dispositivo) non è un errore interno del server
  const f = await pj('/api/fallisci', '{}');
  assert.equal(f.status, 409);
  assert.match((await f.json()).errore, /Nessun dispositivo/);
  assert.equal((await getStato()).esiste, false);
});

test('la vita del dispositivo attraverso l\'API', async (t) => {
  await t.test('all\'inizio non c\'è nessun dispositivo', async () => {
    const st = await getStato();
    assert.equal(st.esiste, false);
    assert.equal(st.cartella, cartella);
  });

  await t.test('nasce: stesse righe della riga di comando', async () => {
    const { stato, dati } = await post('/api/nasce', { nome: 'Caldo 3000' });
    assert.equal(stato, 200);
    assert.equal(dati.codice, 0);
    assert.match(testoRighe(dati.righe), /TESTAMENTO · nasce «Caldo 3000»/);
    assert.equal(dati.stato.dispositivo.bootloader, 'BLOCCATO');
    assert.equal(dati.stato.capsule.length, 1);
    assert.equal(dati.stato.capsule[0].T, 1800000);
  });

  await t.test('aggiorna e tempo', async () => {
    assert.equal((await post('/api/tempo', { mesi: '6' })).dati.codice, 0);
    const { dati } = await post('/api/aggiorna', { versione: '1.1' });
    assert.equal(dati.codice, 0);
    assert.equal(dati.stato.capsule.length, 2);
    assert.equal(dati.stato.capsule[0].meseScadenza, 6);
    assert.equal(dati.stato.storia.length, 2);
  });

  await t.test('il produttore fallisce: niente più aggiornamenti', async () => {
    const f = await post('/api/fallisci');
    assert.equal(f.dati.stato.produttore.fallito, true);
    assert.equal(f.dati.stato.produttore.meseFallimento, 6);
    const a = await post('/api/aggiorna', { versione: '1.2' });
    assert.equal(a.stato, 409);
    assert.match(a.dati.errore, /fallito al mese 6/);
    // un secondo «fallisci» più tardi (un'altra scheda rimasta indietro) non sposta il mese del fallimento
    await post('/api/tempo', { mesi: '1' });
    const f2 = await post('/api/fallisci');
    assert.equal(f2.stato, 409);
    assert.match(f2.dati.errore, /già fallito al mese 6/);
    assert.equal((await getStato()).produttore.meseFallimento, 6);
  });

  await t.test('apri troppo presto: avanzamento via SSE, il calcolo si ferma dove il calendario permette', async () => {
    await post('/api/tempo', { mesi: '5' });                            // mese 12: capsula #2 al 33%
    const ascolto = eventi((v) => v.some((e) => e.evento === 'fine'));
    await new Promise((ok) => setTimeout(ok, 100));
    const r = await post('/api/apri', { numero: 2 });
    assert.equal(r.stato, 202);
    const visti = await ascolto;
    const fine = visti.find((e) => e.evento === 'fine');
    assert.equal(fine.dati.codice, 2);
    assert.match(testoRighe(fine.dati.righe), /Ancora sigillata/);
    const progressi = visti.filter((e) => e.evento === 'progresso');
    assert.ok(progressi.length >= 2, 'almeno due avvisi di avanzamento');
    assert.equal(progressi.at(-1).dati.fatte, 600000);
    const st = await getStato();
    assert.equal(st.capsule[1].fatte, 600000);
  });

  await t.test('a calcolo in corso gli altri comandi aspettano; interrompi salva il lavoro', async () => {
    await post('/api/tempo', { mesi: '12' });                           // mese 24: capsula #2 matura
    const ascolto = eventi((v) => v.some((e) => e.evento === 'fine'));
    await new Promise((ok) => setTimeout(ok, 100));
    await post('/api/apri', { numero: 2 });
    await new Promise((ok) => setTimeout(ok, 300));
    const occupato = await post('/api/tempo', { mesi: '1' });
    assert.equal(occupato.stato, 409);
    assert.match(occupato.dati.errore, /Sto aprendo la capsula #2/);
    assert.equal((await post('/api/ferma')).stato, 202);
    const visti = await ascolto;
    const fine = visti.find((e) => e.evento === 'fine');
    assert.equal(fine.dati.codice, 2);
    assert.match(testoRighe(fine.dati.righe), /Calcolo interrotto a [\d.]+ quadrature/);
    const st = await getStato();
    assert.ok(st.capsule[1].fatte > 600000 && st.capsule[1].fatte < 1800000, String(st.capsule[1].fatte));
    assert.equal(st.lavoro, null);
  });

  let codice2;
  await t.test('riprendi: la capsula si apre e il codice è pubblicato', async () => {
    const ascolto = eventi((v) => v.some((e) => e.evento === 'fine'));
    await new Promise((ok) => setTimeout(ok, 100));
    await post('/api/apri', { numero: 2 });
    const fine = (await ascolto).find((e) => e.evento === 'fine');
    assert.equal(fine.dati.codice, 0, testoRighe(fine.dati.righe));
    assert.match(testoRighe(fine.dati.righe), /Riprendo il calcolo salvato/);
    const st = await getStato();
    codice2 = st.capsule[1].codice;
    assert.match(codice2, /^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);
    assert.equal(st.capsule[1].aperta, true);
  });

  await t.test('installa a bootloader bloccato è rifiutato; sblocca libera; certificato scaricabile', async () => {
    const i = await post('/api/installa', { firmware: 'FirmwareLibero 1.0' });
    assert.equal(i.dati.codice, 2);
    const s = await post('/api/sblocca', { codice: codice2 });
    assert.equal(s.dati.codice, 0, testoRighe(s.dati.righe));
    assert.equal(s.dati.stato.dispositivo.liberato, true);
    assert.equal(s.dati.stato.certificato, true);
    const ok = await post('/api/installa', { firmware: 'FirmwareLibero 1.0' });
    assert.equal(ok.dati.codice, 0);
    assert.equal(ok.dati.stato.dispositivo.firmware, 'FirmwareLibero 1.0');
    const txt = await fetch(base + '/api/certificato.txt');
    assert.equal(txt.status, 200);
    assert.match(await txt.text(), /CERTIFICATO DI LIBERAZIONE/);
    const j = await (await fetch(base + '/api/certificato.json')).json();
    assert.equal(j.ImprontaVerificata, true);
    const h = await fetch(base + '/api/certificato.html?scarica');
    assert.match(h.headers.get('content-disposition'), /certificato-di-liberazione\.html/);
  });

  await t.test('nuovo dispositivo: la cartella creata dal cruscotto si cancella', async () => {
    const r = await post('/api/ricomincia');
    assert.equal(r.dati.stato.esiste, false);
    assert.equal(fs.existsSync(cartella), false);
  });
});

test('nuovo dispositivo: una cartella che non ha creato il cruscotto non si tocca', async () => {
  const altra = path.join(prove, 'non-mia');
  fs.mkdirSync(altra);
  fs.writeFileSync(path.join(altra, 'dispositivo.json'), '{}');
  const s2 = creaServer({ cartella: altra });
  await new Promise((ok) => s2.listen(0, '127.0.0.1', ok));
  try {
    const r = await fetch('http://127.0.0.1:' + s2.address().port + '/api/ricomincia', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(r.status, 409);
    assert.ok(fs.existsSync(path.join(altra, 'dispositivo.json')));
  } finally {
    await s2.chiudiTutto();
  }
});

test('nuovo dispositivo: se nasce in una cartella che aveva già altri file, «Nuovo dispositivo» non la cancella', async () => {
  // prima nasce scriveva il marcatore anche qui, e ricomincia cancellava tutta la cartella dell'utente
  const utente = path.join(prove, 'documenti utente');
  fs.mkdirSync(utente);
  fs.writeFileSync(path.join(utente, 'tesi.txt'), 'da non perdere');
  const s3 = creaServer({ cartella: utente, env: { TESTAMENTO_QUADRATURE_AL_MESE: '50' } });
  await new Promise((ok) => s3.listen(0, '127.0.0.1', ok));
  const p3 = (via) => fetch('http://127.0.0.1:' + s3.address().port + via, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  try {
    assert.equal((await p3('/api/nasce')).status, 200);
    assert.ok(fs.existsSync(path.join(utente, 'dispositivo.json')));
    assert.equal((await p3('/api/ricomincia')).status, 409);
    assert.equal(fs.readFileSync(path.join(utente, 'tesi.txt'), 'utf8'), 'da non perdere');
  } finally {
    await s3.chiudiTutto();
  }
});

test('dispositivo illeggibile nella cartella del cruscotto: la pagina offre «Nuovo dispositivo» e il server lo ricrea', async () => {
  // prima il pulsante restava nascosto (esiste: false) e «nasce» rifiutava la cartella: dalla pagina non si usciva
  const rotta = path.join(prove, 'rotta');
  const s4 = creaServer({ cartella: rotta, env: { TESTAMENTO_QUADRATURE_AL_MESE: '50' } });
  await new Promise((ok) => s4.listen(0, '127.0.0.1', ok));
  const b4 = 'http://127.0.0.1:' + s4.address().port;
  const p4 = (via, corpo = {}) => fetch(b4 + via, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  try {
    assert.equal((await p4('/api/nasce')).status, 200);
    fs.writeFileSync(path.join(rotta, 'dispositivo.json'), '{rotto');
    const st = await (await fetch(b4 + '/api/stato')).json();
    assert.equal(st.esiste, false);
    assert.match(st.errore, /illeggibile/);
    const app = fs.readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
    assert.match(app, /\$\('pulsante-ricomincia'\)\.hidden = !st\.esiste && !st\.errore;/);
    assert.equal((await p4('/api/ricomincia')).status, 200);
    const r = await (await p4('/api/nasce', { nome: 'Di nuovo' })).json();
    assert.equal(r.codice, 0);
    assert.equal(r.stato.dispositivo.nome, 'Di nuovo');
  } finally {
    await s4.chiudiTutto();
  }
});
