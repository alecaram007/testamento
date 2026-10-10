#!/usr/bin/env node
// TESTAMENTO - il server del cruscotto web. Nessuna dipendenza: solo node:http.
//
//   node server.mjs [--dispositivo <cartella>]
//
// Serve web/ e un'API JSON che usa lo stesso nucleo della riga di comando
// (lib/comandi.mjs). "apri" gira in un worker: l'avanzamento delle quadrature
// arriva al browser con i Server-Sent Events (/api/eventi).
// Ascolta solo su 127.0.0.1, alla porta PORT (predefinita 5177).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { esegui } from './lib/comandi.mjs';
import { UscitaRaccolta } from './lib/uscita.mjs';
import { Archivio, ErroreUtente } from './lib/dispositivo.mjs';
import { statoCruscotto } from './lib/cruscotto.mjs';
import { DatiCertificato } from './lib/comandi.mjs';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(QUI, 'web');
const PORTA_PREDEFINITA = 5177;
const MARCATORE = '.cruscotto-testamento';

// --- la cartella del dispositivo del cruscotto -------------------------------
function cartellaDaArgomenti(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i].toLowerCase();
    if ((a === '--dispositivo' || a === '-dispositivo' || a === '-d') && argv[i + 1]) return argv[i + 1];
    if (a.startsWith('--dispositivo=')) return argv[i].substring(argv[i].indexOf('=') + 1);
  }
  return null;
}

export function creaServer(opzioni = {}) {
  const cartella = path.resolve(opzioni.cartella
    || cartellaDaArgomenti(process.argv.slice(2))
    || process.env.TESTAMENTO_WEB_DISPOSITIVO
    || path.join(QUI, 'dispositivo-web'));
  const env = { ...process.env, ...(opzioni.env || {}) };
  delete env.TESTAMENTO_DISPOSITIVO;
  const arc = () => new Archivio(cartella);

  let occupato = null;          // il lavoro in corso: { numero, fatte, totale, finoA, worker, segnale }
  const clienti = new Set();

  function trasmetti(evento, dati) {
    const msg = 'event: ' + evento + '\ndata: ' + JSON.stringify(dati) + '\n\n';
    for (const r of clienti) r.write(msg);
  }

  function stato() {
    let st;
    try { st = statoCruscotto(arc()); }
    catch (e) { st = { esiste: false, cartella, errore: e.message }; }
    st.lavoro = occupato ? { numero: occupato.numero, fatte: occupato.fatte, totale: occupato.totale, finoA: occupato.finoA } : null;
    return st;
  }

  async function comando(args) {
    const uscita = new UscitaRaccolta();
    const codice = await esegui([...args, '--dispositivo', cartella], { uscita, env });
    const st = stato();
    trasmetti('stato', st);
    return { codice, righe: uscita.elenco(), stato: st };
  }

  function rispondi(res, stato, corpo, tipo = 'application/json; charset=utf-8') {
    const dati = typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo);
    res.writeHead(stato, {
      'Content-Type': tipo,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(dati);
  }

  function leggiCorpo(req) {
    return new Promise((risolvi, rifiuta) => {
      let dati = '';
      req.setEncoding('utf8');
      let troppo = false;
      req.on('data', (c) => {
        if (troppo) return;                   // il resto si scarta: la risposta 413 arriva lo stesso
        dati += c;
        if (dati.length > 64 * 1024) { troppo = true; dati = ''; rifiuta(Object.assign(new Error('richiesta troppo grande'), { stato: 413 })); }
      });
      req.on('end', () => {
        if (troppo) return;
        if (!dati) return risolvi({});
        let v;
        try { v = JSON.parse(dati); } catch { return rifiuta(new Error('JSON non valido')); }
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return rifiuta(new Error('JSON non valido: serve un oggetto'));
        risolvi(v);
      });
      req.on('error', rifiuta);
    });
  }

  const TIPI = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
  };

  function servaFile(res, file) {
    fs.readFile(file, (err, dati) => {
      if (err) return rispondi(res, 404, 'Non trovato', 'text/plain; charset=utf-8');
      rispondi(res, 200, dati, TIPI[path.extname(file)] || 'application/octet-stream');
    });
  }

  function apri(numero) {
    const segnale = new SharedArrayBuffer(4);
    const w = new Worker(new URL('./lib/apri-lavoratore.mjs', import.meta.url), {
      workerData: { cartella, numero, env, segnale },
    });
    occupato = { numero, fatte: 0, totale: 0, finoA: 0, worker: w, segnale: new Int32Array(segnale) };
    trasmetti('stato', stato());
    w.on('message', (m) => {
      if (m.tipo === 'progresso') {
        Object.assign(occupato, { fatte: m.fatte, totale: m.totale, finoA: m.finoA });
        trasmetti('progresso', { numero: m.numero, fatte: m.fatte, totale: m.totale, finoA: m.finoA });
      } else if (m.tipo === 'fine') {
        occupato = null;
        trasmetti('fine', { numero: m.numero, codice: m.codice, righe: m.righe });
        trasmetti('stato', stato());
      }
    });
    w.on('error', (e) => {
      occupato = null;
      trasmetti('fine', { numero, codice: 1, righe: [[{ colore: 'Red', testo: '  Errore imprevisto nel calcolo: ' + e.message }]] });
      trasmetti('stato', stato());
    });
    w.on('exit', () => { if (occupato && occupato.worker === w) occupato = null; });
  }

  // Solo richieste da questa macchina e, per le modifiche, solo JSON dalla stessa origine.
  function richiestaAmmessa(req) {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return false;
    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return false;
      const origine = req.headers.origin;
      if (origine && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origine)) return false;
    }
    return true;
  }

  const testo = (v, max = 200) => String(v ?? '').slice(0, max);

  async function api(req, res, url) {
    const via = url.pathname;
    if (req.method === 'GET' && via === '/api/stato') return rispondi(res, 200, stato());

    if (req.method === 'GET' && via === '/api/eventi') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 1500\n\n');
      clienti.add(res);
      res.write('event: stato\ndata: ' + JSON.stringify(stato()) + '\n\n');
      const battito = setInterval(() => res.write(': battito\n\n'), 15000);
      req.on('close', () => { clearInterval(battito); clienti.delete(res); });
      return;
    }

    const certificato = /^\/api\/certificato\.(txt|html|json)$/.exec(via);
    if (req.method === 'GET' && certificato) {
      const a = arc();
      if (!a.esiste() || !a.leggiStato().Rom.Liberato) return rispondi(res, 404, { errore: 'Il dispositivo non è ancora libero: nessun certificato.' });
      await esegui(['certificato', '--dispositivo', cartella], { uscita: new UscitaRaccolta(), env });
      const f = { txt: a.FileCertificato, html: a.FileCertificatoHtml, json: a.FileCertificatoJson }[certificato[1]];
      const tipo = { txt: 'text/plain; charset=utf-8', html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8' }[certificato[1]];
      if (url.searchParams.has('scarica')) res.setHeader('Content-Disposition', 'attachment; filename="' + path.basename(f) + '"');
      return rispondi(res, 200, fs.readFileSync(f), tipo);
    }

    if (req.method !== 'POST') return rispondi(res, 405, { errore: 'Metodo non ammesso.' });
    let corpo;
    try { corpo = await leggiCorpo(req); } catch (e) {
      if (e.stato === 413) res.setHeader('Connection', 'close');
      return rispondi(res, e.stato || 400, { errore: e.message });
    }

    if (via === '/api/ferma') {
      if (!occupato) return rispondi(res, 409, { errore: 'Nessun calcolo in corso.' });
      Atomics.store(occupato.segnale, 0, 1);
      return rispondi(res, 202, { ok: true });
    }

    if (occupato)
      return rispondi(res, 409, { errore: 'Sto aprendo la capsula #' + occupato.numero + ': aspetta che finisca o interrompi il calcolo.' });

    switch (via) {
      case '/api/nasce': {
        const args = ['nasce', testo(corpo.nome, 60) || 'Caldo 3000'];
        if (corpo.bit) args.push('--bit', testo(corpo.bit, 5));
        // Il marcatore (che autorizza «Nuovo dispositivo» a cancellare la cartella) solo se la cartella
        // la crea il cruscotto adesso, o era vuota: mai in una cartella dell'utente con dentro altri file.
        let nuova;
        try { nuova = !fs.existsSync(cartella) || fs.readdirSync(cartella).length === 0; } catch { nuova = false; }
        const r = await comando(args);
        if (r.codice === 0 && nuova) {
          try { fs.writeFileSync(path.join(cartella, MARCATORE), 'Cartella creata dal cruscotto web di Testamento: «Nuovo dispositivo» la cancella.\n'); } catch {}
        }
        return rispondi(res, 200, r);
      }
      case '/api/tempo':
        return rispondi(res, 200, await comando(['tempo', testo(corpo.mesi, 6)]));
      case '/api/aggiorna': {
        const prod = arc().leggiCruscotto();
        if (prod.ProduttoreFallito)
          return rispondi(res, 409, { errore: 'Il produttore è fallito al mese ' + prod.MeseFallimento + ': non può più rilasciare aggiornamenti.' });
        return rispondi(res, 200, await comando(['aggiorna', testo(corpo.versione, 40)]));
      }
      case '/api/fallisci': {
        const a = arc();
        const s = a.leggiStato();
        // un secondo «fallisci» (da un'altra scheda rimasta indietro) non deve spostare il mese del fallimento
        const prima = a.leggiCruscotto();
        if (prima.ProduttoreFallito)
          return rispondi(res, 409, { errore: 'Il produttore è già fallito al mese ' + prima.MeseFallimento + '.' });
        a.salvaCruscotto({ ProduttoreFallito: true, MeseFallimento: s.Mese });
        const st = stato();
        trasmetti('stato', st);
        return rispondi(res, 200, {
          codice: 0,
          righe: [[], [{ colore: 'Magenta', testo: '  Mese ' + s.Mese + ': il produttore fallisce.' }],
            [{ colore: 'DarkCyan', testo: '  Nessun comando lo annuncia: il «' + s.Nome + '» non lo sa e non ha bisogno di saperlo.' }],
            [{ colore: 'DarkCyan', testo: '  Semplicemente, da oggi non arriverà più nessun aggiornamento.' }]],
          stato: st,
        });
      }
      case '/api/apri': {
        const n = Number(corpo.numero);
        if (!Number.isInteger(n) || n < 1) return rispondi(res, 400, { errore: 'Numero di capsula non valido.' });
        if (!arc().esiste()) return rispondi(res, 409, { errore: 'Nessun dispositivo.' });
        apri(n);
        return rispondi(res, 202, { ok: true, numero: n });
      }
      case '/api/sblocca':
        return rispondi(res, 200, await comando(['sblocca', testo(corpo.codice, 100)]));
      case '/api/installa':
        return rispondi(res, 200, await comando(['installa', testo(corpo.firmware, 60)]));
      case '/api/indovina':
        return rispondi(res, 200, await comando(['indovina', String(Math.max(0.5, Math.min(10, Number(corpo.secondi) || 2)))]));
      case '/api/stato-testo':
        return rispondi(res, 200, await comando(['stato']));
      case '/api/certificato':
        return rispondi(res, 200, await comando(['certificato']));
      case '/api/ricomincia': {
        if (fs.existsSync(cartella)) {
          if (!fs.existsSync(path.join(cartella, MARCATORE)))
            return rispondi(res, 409, { errore: "La cartella '" + cartella + "' non l'ha creata il cruscotto: non la tocco." });
          fs.rmSync(cartella, { recursive: true, force: true });
        }
        const st = stato();
        trasmetti('stato', st);
        return rispondi(res, 200, { codice: 0, righe: [], stato: st });
      }
      default:
        return rispondi(res, 404, { errore: 'API sconosciuta.' });
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!richiestaAmmessa(req)) return rispondi(res, 403, { errore: 'Richiesta non ammessa.' });
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return rispondi(res, 405, 'Metodo non ammesso', 'text/plain; charset=utf-8');
      // Il codice condiviso con il browser: solo lib/puro.mjs.
      if (url.pathname === '/lib/puro.mjs') return servaFile(res, path.join(QUI, 'lib', 'puro.mjs'));
      let rel;
      try { rel = decodeURIComponent(url.pathname); } catch { rel = null; }
      if (rel == null || rel.includes('\0')) return rispondi(res, 400, 'Percorso non valido', 'text/plain; charset=utf-8');
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.resolve(WEB, '.' + rel);
      if (!file.startsWith(WEB + path.sep)) return rispondi(res, 403, 'Vietato', 'text/plain; charset=utf-8');
      return servaFile(res, file);
    } catch (e) {
      // un errore d'uso (per esempio nessun dispositivo) non è un guasto del server
      if (!res.headersSent) rispondi(res, e instanceof ErroreUtente ? 409 : 500, { errore: e.message });
    }
  });

  server.cartella = cartella;
  server.chiudiTutto = () => {
    if (occupato) occupato.worker.terminate();
    for (const r of clienti) r.end();
    clienti.clear();
    return new Promise((ok) => server.close(ok));
  };
  return server;
}

// Avvio diretto: node server.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const porta = Number(process.env.PORT) || PORTA_PREDEFINITA;
  const server = creaServer();
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error('  La porta ' + porta + ' è già occupata: chiudi l\'altro server o usa PORT=<numero> node server.mjs');
    else console.error('  Errore del server: ' + e.message);
    process.exitCode = 1;
  });
  server.listen(porta, '127.0.0.1', () => {
    console.log('');
    console.log('  TESTAMENTO · cruscotto web');
    console.log('  Indirizzo:   http://localhost:' + porta + '   (http://127.0.0.1:' + porta + ')');
    console.log('  Dispositivo: ' + server.cartella);
    console.log('  Per fermarlo: Ctrl+C');
    console.log('');
  });
  const chiudi = () => { server.chiudiTutto().then(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGINT', chiudi);
  process.on('SIGTERM', chiudi);
}
