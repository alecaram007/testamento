// Strumenti comuni ai test: cartelle di prova e la riga di comando lanciata davvero.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(MAC, 'bin', 'testamento.mjs');
// La demo reale della versione Windows (solo lettura).
export const DEMO_WINDOWS = path.resolve(MAC, '..', 'demo', 'caldo-3000');

export function cartellaDiProva(nome) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'testamento-' + nome + '-'));
}

// Lancia "node bin/testamento.mjs <args> --dispositivo <cartella>" con l'uscita rediretta,
// come faceva test.ps1 con testamento.exe. Restituisce { codice, testo }.
export function T(cartella, args, env = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args, '--dispositivo', cartella], {
    encoding: 'utf8',
    env: { ...process.env, TESTAMENTO_QUADRATURE_AL_MESE: '50', NO_COLOR: '1', ...env },
  });
  return { codice: r.status, testo: (r.stdout || '') + (r.stderr || '') };
}

export function leggiStato(cartella) {
  return JSON.parse(fs.readFileSync(path.join(cartella, 'dispositivo.json'), 'utf8'));
}

export function codicePubblicato(cartella, n) {
  const f = path.join(cartella, 'capsule', 'capsula-' + n + '.codice.txt');
  if (!fs.existsSync(f)) return null;
  const m = /([0-9A-F]{4}-){7}[0-9A-F]{4}/.exec(fs.readFileSync(f, 'utf8'));
  return m ? m[0] : null;
}

// Cambia la prima cifra esadecimale (come Altera in test.ps1).
export function altera(h) {
  return (h[0] === '0' ? '1' : '0') + h.substring(1);
}
