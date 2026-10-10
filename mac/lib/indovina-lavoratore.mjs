// TESTAMENTO - un filo di "indovina": forza bruta vera su SHA-256(sale || codice).
// Parte da un codice casuale e lo incrementa, come i thread dell'originale.

import { parentPort, workerData } from 'node:worker_threads';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const { sale, bersaglio, scadenza } = workerData;
const s = Buffer.from(sale);
const obiettivo = Buffer.from(bersaglio);
const buf = Buffer.alloc(s.length + 16);
s.copy(buf, 0);
randomBytes(16).copy(buf, s.length);

let mie = 0;
let trovati = 0;
while (Date.now() < scadenza) {
  for (let k = 0; k < 1024; k++) {
    for (let j = s.length; j < buf.length; j++) { buf[j] = (buf[j] + 1) & 255; if (buf[j] !== 0) break; }
    if (timingSafeEqual(createHash('sha256').update(buf).digest(), obiettivo)) trovati++;
  }
  mie += 1024;
}
parentPort.postMessage({ mie, trovati });
