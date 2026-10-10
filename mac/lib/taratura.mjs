// TESTAMENTO - la taratura: quante quadrature modulo N fa questo Mac in un secondo.
//
// Il file è mac/taratura.json (stesso formato di bin\taratura.json dell'originale).
// Con un modulo da 2048 bit (novità Mac) la taratura è a parte: mac/taratura-2048.json.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Primi, PuzzleRsw } from './crittografia.mjs';
import { Json, SCHEMI } from './dispositivo.mjs';
import { MESI_IT } from './puro.mjs';

export const CARTELLA_MAC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function cartellaTaratura(env = process.env) {
  return env.TESTAMENTO_CARTELLA_TARATURA ? path.resolve(env.TESTAMENTO_CARTELLA_TARATURA) : CARTELLA_MAC;
}

export function fileTaratura(bit = 1024, env = process.env) {
  return path.join(cartellaTaratura(env), bit === 1024 ? 'taratura.json' : 'taratura-' + bit + '.json');
}

// Il nome da mostrare nei messaggi, come "bin\taratura.json" nell'originale.
export function nomeTaratura(bit = 1024, env = process.env) {
  const f = fileTaratura(bit, env);
  return path.dirname(f) === CARTELLA_MAC ? 'mac/' + path.basename(f) : f;
}

function dataMisura(d) {
  const due = (n) => String(n).padStart(2, '0');
  return d.getDate() + ' ' + MESI_IT[d.getMonth()] + ' ' + d.getFullYear() + ', ' + due(d.getHours()) + ':' + due(d.getMinutes());
}

// Misura per 'durata' secondi le quadrature modulo un N casuale da 'bit' bit.
export function misura(durata, bit = 1024) {
  const n = Primi.casuale(bit) | 1n;
  let x = Primi.casualeSotto(n);
  x = PuzzleRsw.quadrature(x, 5000, n, 5000, null);          // riscaldamento
  const inizio = performance.now();
  let fatte = 0;
  let trascorsi = 0;
  while ((trascorsi = (performance.now() - inizio) / 1000) < durata) {
    x = PuzzleRsw.quadrature(x, 5000, n, 5000, null);
    fatte += 5000;
  }
  trascorsi = (performance.now() - inizio) / 1000;
  return {
    QuadratureAlSecondo: Math.round(fatte / trascorsi),
    BitModulo: bit,
    Misurata: dataMisura(new Date()),
  };
}

export function leggi(bit = 1024, env = process.env) {
  try {
    const t = Json.leggi(fileTaratura(bit, env), SCHEMI.Taratura);
    return t;
  } catch {
    return null;
  }
}

export function salva(t, env = process.env) {
  Json.scrivi(fileTaratura(t.BitModulo, env), SCHEMI.Taratura, t);
}
