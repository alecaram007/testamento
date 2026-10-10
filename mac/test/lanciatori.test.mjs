// 7 · avvia.command provato senza aprire davvero il browser: un finto «open»
// davanti nel PATH scrive in un file l'indirizzo che avrebbe aperto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MAC, cartellaDiProva } from './aiuto.mjs';

const prove = cartellaDiProva('lanciatori');
test.after(() => fs.rmSync(prove, { recursive: true, force: true }));

const finto = path.join(prove, 'finto');
const aperti = path.join(prove, 'open.log');
fs.mkdirSync(finto);
fs.writeFileSync(path.join(finto, 'open'), '#!/bin/bash\necho "$*" >> "' + aperti + '"\n', { mode: 0o755 });

function avvia(porta) {
  const p = spawn(path.join(MAC, 'avvia.command'), [], {
    cwd: prove,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: finto + ':' + process.env.PATH, PORT: String(porta), TESTAMENTO_WEB_DISPOSITIVO: path.join(prove, 'dispositivo') },
  });
  let testo = '';
  p.stdout.on('data', (d) => { testo += d; });
  p.stderr.on('data', (d) => { testo += d; });
  const fine = new Promise((ok) => p.on('exit', (codice) => ok(codice)));
  return { p, fine, testo: () => testo };
}

test('avvia.command con la porta occupata da un altro programma non apre il browser su quello', async () => {
  // prima apriva comunque http://localhost:<porta>, cioè l'altro programma
  fs.rmSync(aperti, { force: true });
  const altro = http.createServer((q, r) => r.end('un altro progetto'));
  await new Promise((ok) => altro.listen(0, '127.0.0.1', ok));
  try {
    const a = avvia(altro.address().port);
    const codice = await Promise.race([a.fine, new Promise((ok) => setTimeout(() => ok('scaduto'), 15000).unref())]);
    if (codice === 'scaduto') a.p.kill();
    assert.equal(codice, 1, a.testo());
    assert.match(a.testo(), /già occupata/);
    assert.equal(fs.existsSync(aperti), false, 'non doveva aprire il browser');
  } finally {
    await new Promise((ok) => altro.close(ok));
  }
});

test('avvia.command avvia il server, apre il browser e alla chiusura spegne il server', async () => {
  fs.rmSync(aperti, { force: true });
  const libera = http.createServer();
  await new Promise((ok) => libera.listen(0, '127.0.0.1', ok));
  const porta = libera.address().port;
  await new Promise((ok) => libera.close(ok));
  const a = avvia(porta);
  try {
    const limite = Date.now() + 15000;
    while (!fs.existsSync(aperti) && Date.now() < limite) await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(fs.readFileSync(aperti, 'utf8').trim(), 'http://localhost:' + porta, a.testo());
    const st = await (await fetch('http://127.0.0.1:' + porta + '/api/stato')).json();
    assert.equal(st.esiste, false);
  } finally {
    a.p.kill('SIGTERM');
    await a.fine;
  }
  await new Promise((ok) => setTimeout(ok, 1500));
  await assert.rejects(fetch('http://127.0.0.1:' + porta + '/api/stato'), 'il server doveva spegnersi con la finestra');
});
