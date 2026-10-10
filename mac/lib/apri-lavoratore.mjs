// TESTAMENTO - "apri" dentro un worker, per il server web.
// Esegue lo stesso comando della riga di comando; manda al server l'avanzamento
// delle quadrature e, alla fine, le righe stampate e il codice di uscita.
// Il server può chiedere di interrompere scrivendo 1 nel SharedArrayBuffer:
// il lavoro fatto viene salvato in capsula-N.lavoro.json e si riprende da lì.

import { parentPort, workerData } from 'node:worker_threads';
import { esegui } from './comandi.mjs';
import { UscitaRaccolta } from './uscita.mjs';

const { cartella, numero, env, segnale } = workerData;
const ferma = new Int32Array(segnale);
const uscita = new UscitaRaccolta();

const codice = await esegui(['apri', String(numero), '--dispositivo', cartella], {
  uscita,
  env,
  alProgresso: (n, fatte, totale, finoA) => parentPort.postMessage({ tipo: 'progresso', numero: n, fatte, totale, finoA }),
  interrompi: () => Atomics.load(ferma, 0) === 1,
});
parentPort.postMessage({ tipo: 'fine', numero, codice, righe: uscita.elenco() });
