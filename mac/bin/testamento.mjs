#!/usr/bin/env node
// TESTAMENTO - l'hardware che si libera da solo quando il produttore lo abbandona.
//
// Riga di comando del simulatore:   testamento <comando> [argomenti] [--dispositivo <cartella>]
// (testamento aiuto per l'elenco dei comandi)

import { esegui } from '../lib/comandi.mjs';
import { UscitaTerminale } from '../lib/uscita.mjs';

// Se chi legge chiude la pipe (per esempio con | head), si smette di scrivere senza drammi.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0); throw e; });

const codice = await esegui(process.argv.slice(2), { uscita: new UscitaTerminale(process.stdout) });
// Niente process.exit(): su macOS l'uscita verso una pipe è asincrona e va lasciata finire.
process.exitCode = codice;
