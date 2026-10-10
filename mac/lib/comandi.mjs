// TESTAMENTO - i comandi e il racconto a schermo (port di src/Programma.cs).
//
// La stessa funzione esegui() la usano la riga di comando (bin/testamento.mjs),
// il server web (server.mjs, anche dentro un worker per "apri") e i test.
// I messaggi sono quelli dell'originale, carattere per carattere; cambiano solo
// i separatori dei percorsi (capsule/capsula-1.json invece di capsule\capsula-1.json).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { Codice, CapsulaManomessaException, PuzzleRsw } from './crittografia.mjs';
import { Archivio, ErroreUtente, Json, Rom, FORMATO_DISPOSITIVO } from './dispositivo.mjs';
import * as Taratura from './taratura.mjs';
import { UscitaTerminale } from './uscita.mjs';
import {
  aBig, daBig, aByte, daByte, n0, dec, percento, mesi as Mesi, dataSimulata, scientifico, raggruppa,
  abbrevia, barraTesto, normalizzaVersione,
} from './puro.mjs';

// Nel simulatore un mese di calendario "pesa" 0,6 secondi di calcolo su questo Mac:
// una capsula da 18 mesi si apre in circa 11 secondi.
export const SECONDI_PER_MESE = 0.6;

export const OK = 0;
export const ERRORE = 1;
export const RIFIUTATO = 2;     // codice scaduto o falso, installazione negata, capsula ancora sigillata
export const MANOMESSA = 3;     // l'HMAC della capsula non torna

const BLOCCATO = 'BLOCCATO';
const SBLOCCATO = 'SBLOCCATO';

// Novità Mac: limite ai tentativi di sblocca con attesa crescente.
export const CODICI_FALSI_LIBERI = 5;          // i primi 5 codici falsi di fila non costano nulla
export const ATTESA_MASSIMA_S = 3600;          // poi 1 s, 2 s, 4 s... fino a un'ora

export const BIT_AMMESSI = [1024, 2048];

export class Interrotto extends Error {
  constructor() { super('calcolo interrotto'); this.name = 'Interrotto'; }
}

// ---------------------------------------------------------------------------
// Il contesto di un comando: dove scrivere, le variabili d'ambiente, i ganci per il web
// ---------------------------------------------------------------------------
//   uscita       UscitaTerminale o UscitaRaccolta
//   env          variabili d'ambiente (TESTAMENTO_DISPOSITIVO, TESTAMENTO_QUADRATURE_AL_MESE...)
//   alProgresso  (numero, fatte, totale, consentite) durante le quadrature di "apri"
//   interrompi   () => true per fermare le quadrature (il lavoro viene salvato)
//   ora          () => millisecondi, per i test del limite ai tentativi
class Contesto {
  constructor(opzioni = {}) {
    this.uscita = opzioni.uscita || new UscitaTerminale();
    this.env = opzioni.env || process.env;
    this.alProgresso = opzioni.alProgresso || null;
    this.interrompi = opzioni.interrompi || null;
    this.ora = opzioni.ora || (() => Date.now());
  }

  Riga(a, b) {
    if (a === undefined) this.uscita.riga();
    else if (b === undefined) this.uscita.riga(a);
    else this.uscita.riga(a, b);
  }

  Pezzo(colore, testo) { this.uscita.pezzo(colore, testo); }
}

export async function esegui(args, opzioni = {}) {
  const x = new Contesto(opzioni);
  try {
    return await Esegui(x, args);
  } catch (e) {
    if (e instanceof ErroreUtente) {
      x.Riga();
      x.Riga('Red', '  Errore: ' + e.message);
      return ERRORE;
    }
    x.Riga();
    x.Riga('Red', '  Errore imprevisto (' + (e && e.name ? e.name : 'Error') + '): ' + (e && e.message));
    return ERRORE;
  }
}

async function Esegui(x, args) {
  const pos = [];
  let cartella = null;
  let bit = null;
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    const al = a.toLowerCase();
    if (al === '-dispositivo' || al === '--dispositivo' || al === '-d') {
      if (i + 1 >= args.length) throw new ErroreUtente('Manca la cartella dopo ' + a + '.');
      cartella = String(args[++i]);
    } else if (al.startsWith('--dispositivo=') || al.startsWith('-dispositivo=')) {
      cartella = a.substring(a.indexOf('=') + 1);
    } else if (al === '--bit' || al === '-bit') {
      if (i + 1 >= args.length) throw new ErroreUtente('Manca il numero di bit dopo ' + a + '.');
      bit = String(args[++i]);
    } else if (al.startsWith('--bit=') || al.startsWith('-bit=')) {
      bit = a.substring(a.indexOf('=') + 1);
    } else {
      pos.push(a);
    }
  }
  if (pos.length === 0) { Aiuto(x); return OK; }
  if (!cartella) cartella = x.env.TESTAMENTO_DISPOSITIVO;
  if (!cartella) cartella = 'dispositivo';
  if (bit == null && x.env.TESTAMENTO_BIT_MODULO) bit = x.env.TESTAMENTO_BIT_MODULO;

  const arc = new Archivio(cartella);
  const resto = pos.slice(1).join(' ').trim();
  switch (pos[0].toLowerCase()) {
    case 'aiuto':
    case 'help':
    case '-h':
    case '--help':
    case '-?':
    case '/?':
      Aiuto(x);
      return OK;
    case 'nasce': return Nasce(x, arc, resto, LeggiBit(bit));
    case 'aggiorna': return Aggiorna(x, arc, resto);
    case 'tempo': return Tempo(x, arc, resto);
    case 'stato': return Stato(x, arc);
    case 'apri': return Apri(x, arc, resto);
    case 'sblocca': return Sblocca(x, arc, resto);
    case 'installa': return Installa(x, arc, resto);
    case 'indovina': return Indovina(x, arc, resto);
    case 'taratura': return RifaiTaratura(x, LeggiBit(resto || bit));
    case 'certificato': return EsportaCertificato(x, arc);
    default:
      throw new ErroreUtente("Comando sconosciuto: '" + pos[0] + "'. Scrivi:  testamento aiuto");
  }
}

function LeggiBit(testo) {
  if (testo == null || testo === '') return 1024;
  const b = Number(String(testo).trim());
  if (!BIT_AMMESSI.includes(b))
    throw new ErroreUtente("Modulo non valido: '" + testo + "'. Si può scegliere tra " + BIT_AMMESSI.join(' e ') + ' bit (per esempio --bit 2048).');
  return b;
}

// =====================================================================
// nasce
// =====================================================================
function Nasce(x, arc, nome, bit) {
  if (nome.length === 0) throw new ErroreUtente('Serve un nome:  testamento nasce "Caldo 3000"');
  if (arc.esiste()) {
    const c = arc.leggiStato();
    throw new ErroreUtente("In '" + arc.Radice + "' esiste già un dispositivo («" + c.Nome + '»). Scegli un\'altra cartella con --dispositivo <cartella>.');
  }

  const oggi = new Date();
  const s = {
    Formato: FORMATO_DISPOSITIVO,
    Nome: nome,
    AnnoNascita: oggi.getFullYear(),
    MeseNascita: oggi.getMonth() + 1,
    Mese: 0,
    Firmware: 'v1.0',
    FirmwareUfficiale: true,
    MeseUltimoAggiornamento: 0,
    Bootloader: BLOCCATO,
    MeseLiberazione: -1,
    QuadratureAlMese: 0,
    QuadratureAlSecondo: 0,
    Rom: { CodiceInVigore: 0, Liberato: false, Codici: [] },
    Storia: [],
  };
  AggiungiStoria(s, 'v1.0', true);

  x.Riga();
  x.Riga('White', '  TESTAMENTO · nasce «' + nome + '» · ' + Data(s, 0));
  x.Riga('DarkGray', '  cartella del dispositivo: ' + arc.Radice);

  const { qpm, qps, origine } = QuadratureAlMese(x, bit);
  s.QuadratureAlMese = qpm;
  s.QuadratureAlSecondo = qps;

  x.Riga();
  if (qps > 0) {
    x.Riga('  Taratura: questo PC fa ' + n0(qps) + ' quadrature al secondo modulo N da ' + bit + ' bit');
    x.Riga('DarkGray', '  (' + origine + ').');
    x.Riga('DarkGray', '  Nel simulatore 1 mese = ' + n0(qpm) + ' quadrature ≈ ' + dec(qpm / qps, 1) + ' s di calcolo.');
  } else {
    x.Riga('DarkGray', '  Taratura ' + origine + ': 1 mese = ' + n0(qpm) + ' quadrature (modalità di prova).');
  }
  x.Riga();
  x.Riga('  Il produttore installa il firmware v1.0.');
  x.Riga('  Bootloader: BLOCCATO (accetta solo firmware firmato dal produttore).');
  x.Riga();
  x.Riga('  La ROM di avvio genera il codice di liberazione #1: 128 bit dal generatore casuale del chip.');

  const r = Rom.nuovoTestamento(s, 'v1.0', bit / 2);
  arc.salvaCapsula(r.capsula);
  arc.salvaStato(s);
  MostraSigillatura(x, arc, s, r);

  x.Riga();
  x.Riga('Green', '  Il codice non lo conosce nessuno: né il produttore, né il dispositivo.');
  x.Riga('  Finché arrivano aggiornamenti, ogni capsula che si apre contiene un codice già scaduto.');
  x.Riga("  Se gli aggiornamenti si fermano, l'ultima capsula si apre e libera il «" + nome + '».');
  return OK;
}

function MostraSigillatura(x, arc, s, r) {
  const c = r.capsula;
  const apre = c.MeseCreazione + c.MesiAttesa;
  x.Riga("    nella ROM resta solo l'impronta  SHA-256(sale || codice) = " + abbrevia(r.impronta.Impronta));
  x.Riga('DarkGray', '    il codice stesso non viene scritto da nessuna parte');
  x.Riga('    la ROM lo chiude nella capsula #' + c.Numero + ' (sigillata in ' + dec(r.secondi, 1) + ' s):');
  x.Riga('Cyan', '      puzzle a tempo RSW · N da ' + c.BitModulo + ' bit · T = ' + n0(c.T) + ' quadrature = ' + c.MesiAttesa + ' mesi di calcolo');
  x.Riga('Cyan', '      p, q e φ(N) dimenticati: ora nemmeno il dispositivo può aprirla in fretta');
  x.Riga('Cyan', '      si apre al mese ' + apre + ' (' + Data(s, apre) + ') · pubblicata in ' + Relativo(arc, arc.fileCapsula(c.Numero)));
}

// =====================================================================
// aggiorna
// =====================================================================
function Aggiorna(x, arc, versione) {
  if (versione.length === 0) throw new ErroreUtente('Serve una versione:  testamento aggiorna 1.1');
  const s = arc.leggiStato();
  const v = normalizzaVersione(versione);
  x.Riga();
  if (s.Rom.Liberato) {
    x.Riga('Yellow', '  Il «' + s.Nome + '» è libero dal mese ' + s.MeseLiberazione + ': la ROM non genera più capsule.');
    x.Riga('DarkGray', '  Un nuovo firmware, anche del produttore, si installa come qualunque altro:  testamento installa "' + v + '"');
    return RIFIUTATO;
  }
  if (v.toLowerCase() === String(s.Firmware).toLowerCase())
    throw new ErroreUtente('Il firmware ' + v + ' è già installato.');

  const prima = s.Firmware;
  const vecchio = Rom.inVigore(s);
  const eraMatura = vecchio != null && s.Mese >= vecchio.MeseCreazione + Rom.MESI_ATTESA;

  // Novità Mac: il modulo della nuova capsula è quello delle capsule precedenti (1024 o 2048 bit).
  let bitPrimi = Rom.BIT_PRIMI;
  if (vecchio != null) {
    // L'originale qui non legge la capsula: un file rovinato non deve fermare l'aggiornamento.
    let cv = null;
    try { cv = arc.leggiCapsula(vecchio.Numero); } catch { cv = null; }
    if (cv && BIT_AMMESSI.includes(cv.BitModulo)) bitPrimi = cv.BitModulo / 2;
  }

  x.Riga('White', '  Il produttore rilascia il firmware ' + v + ' · mese ' + s.Mese + ' · ' + Data(s, s.Mese));
  x.Riga('  Firmware ' + prima + ' → ' + v + ' (firma del produttore verificata dal bootloader).');
  s.Firmware = v;
  s.FirmwareUfficiale = true;
  s.MeseUltimoAggiornamento = s.Mese;
  AggiungiStoria(s, v, true);

  x.Riga();
  x.Riga('  La ROM vede cambiare il firmware e ruota il codice di liberazione:');
  const r = Rom.nuovoTestamento(s, v, bitPrimi);
  arc.salvaCapsula(r.capsula);
  arc.salvaStato(s);

  if (r.scaduto != null)
    x.Riga('Yellow', '    codice #' + r.scaduto.Numero + ' (' + r.scaduto.Firmware + ') → SCADUTO: da ora non sblocca più nulla');
  x.Riga('    nuovo codice #' + r.impronta.Numero + ', generato dalla ROM, non dal produttore');
  MostraSigillatura(x, arc, s, r);
  x.Riga();
  if (eraMatura) {
    x.Riga('Yellow', '  Nota: la capsula #' + vecchio.Numero + ' era già matura. Chi voleva liberare il dispositivo con il suo codice');
    x.Riga('Yellow', '  doveva farlo prima di accettare questo aggiornamento: ora quel codice è scaduto.');
  }
  x.Riga('DarkGray', '  Il produttore ha distribuito il firmware, non il codice: quello lo conosce solo la capsula.');
  x.Riga('DarkGray', '  Il conto alla rovescia riparte da capo: ' + Rom.MESI_ATTESA + ' mesi da oggi.');
  return OK;
}

// =====================================================================
// tempo
// =====================================================================
function LeggiIntero(testo) {
  if (!/^\s*[+-]?\d+\s*$/.test(testo)) return null;
  const n = Number(testo.trim());
  if (!Number.isSafeInteger(n) || n > 2147483647 || n < -2147483648) return null;
  return n;
}

function Tempo(x, arc, arg) {
  const s = arc.leggiStato();
  if (arg.length === 0) {
    x.Riga();
    x.Riga('  Siamo al mese ' + s.Mese + ' dalla nascita del «' + s.Nome + '» · ' + Data(s, s.Mese) + '.');
    return OK;
  }
  const mesi = LeggiIntero(arg);
  if (mesi == null || mesi < 0 || mesi > 1200)
    throw new ErroreUtente("Numero di mesi non valido: '" + arg + "'. Esempio:  testamento tempo 6");

  const prima = s.Mese;
  s.Mese += mesi;
  arc.salvaStato(s);

  x.Riga();
  x.Riga('Magenta', '  Passano ' + Mesi(mesi) + ' (simulazione). Siamo al mese ' + s.Mese + ' · ' + Data(s, s.Mese) + '.');
  const uff = UltimaUfficiale(s);
  const senza = s.Mese - s.MeseUltimoAggiornamento;
  if (!s.Rom.Liberato)
    x.Riga('DarkGray', '  Ultimo aggiornamento ufficiale: ' + uff.Firmware + ' al mese ' + uff.Mese + (senza > 0 ? ', ' + Mesi(senza) + ' fa.' : ', questo mese.'));

  let evento = false;
  for (const imp of s.Rom.Codici) {
    const apre = imp.MeseCreazione + Rom.MESI_ATTESA;
    if (apre <= prima || apre > s.Mese) continue;
    evento = true;
    x.Riga('  · Al mese ' + apre + ' la capsula #' + imp.Numero + ' ha compiuto ' + Rom.MESI_ATTESA + ' mesi: ora chiunque può aprirla.');
    if (s.Rom.Liberato) {
      x.Riga('DarkGray', '    Il dispositivo però è già libero.');
    } else if (imp.Numero === s.Rom.CodiceInVigore) {
      x.Riga('Green', '    Contiene il codice in vigore: nessun aggiornamento è arrivato dopo di lei.');
      x.Riga('Green', '    Chi la apre (testamento apri ' + imp.Numero + ') può liberare il «' + s.Nome + '».');
    } else {
      x.Riga('DarkYellow', '    Contiene un codice già scaduto: era per ' + imp.Firmware + ', poi è arrivato ' + imp.ScadutoCon + '.');
    }
  }
  if (!evento && !s.Rom.Liberato) {
    const iv = Rom.inVigore(s);
    const apre = iv.MeseCreazione + Rom.MESI_ATTESA;
    if (s.Mese < apre)
      x.Riga('DarkGray', '  Senza nuovi aggiornamenti, la capsula #' + iv.Numero + ' si aprirà tra ' + Mesi(apre - s.Mese) + ' (mese ' + apre + ').');
    else
      x.Riga('Cyan', '  La capsula #' + iv.Numero + ' è matura da ' + Mesi(s.Mese - apre) + ': il «' + s.Nome + '» può essere liberato.');
  }
  return OK;
}

// =====================================================================
// stato
// =====================================================================
function Colonne(a, b, c, d, e) {
  return '  ' + a.padEnd(8) + ' ' + b.padEnd(8) + ' ' + c.padEnd(9) + ' ' + d.padEnd(9) + ' ' + e;
}

function Stato(x, arc) {
  const s = arc.leggiStato();
  const uff = UltimaUfficiale(s);
  const senza = s.Mese - s.MeseUltimoAggiornamento;
  const iv = Rom.inVigore(s);
  const apre = iv.MeseCreazione + Rom.MESI_ATTESA;

  x.Riga();
  x.Riga('White', '  TESTAMENTO · «' + s.Nome + '» · mese ' + s.Mese + ' dalla nascita · ' + Data(s, s.Mese));
  x.Riga();
  if (s.Rom.Liberato) Campo(x, 'Stato', 'LIBERO', 'Green');
  else if (s.Mese >= apre) Campo(x, 'Stato', "LIBERABILE: l'ultima capsula è matura", 'Cyan');
  else Campo(x, 'Stato', 'BLOCCATO, sotto il controllo del produttore', 'Yellow');
  Campo(x, 'Firmware', s.Firmware + (s.FirmwareUfficiale ? ' (ufficiale)' : ' (non ufficiale, scelto dal proprietario)'), 'Gray');
  if (s.Rom.Liberato) Campo(x, 'Bootloader', SBLOCCATO + ' dal mese ' + s.MeseLiberazione, 'Green');
  else Campo(x, 'Bootloader', BLOCCATO, 'Yellow');
  Campo(x, 'Ultimo aggiornamento', uff.Firmware + ' al mese ' + uff.Mese + (senza > 0 ? ', ' + Mesi(senza) + ' fa' : ', questo mese'), 'Gray');
  if (s.Rom.Liberato)
    Campo(x, 'Codice usato', '#' + iv.Numero + ' · impronta ' + abbrevia(iv.Impronta) + ' · il fusibile della ROM è bruciato', 'Gray');
  else
    Campo(x, 'Codice in vigore', '#' + iv.Numero + ' · impronta ' + abbrevia(iv.Impronta) + ' (il codice sta solo nella capsula)', 'Gray');
  x.Riga();

  x.Riga('DarkGray', Colonne('CAPSULA', 'CREATA', 'FIRMWARE', 'SI APRE', 'STATO'));
  for (const imp of s.Rom.Codici) {
    const c = arc.leggiCapsula(imp.Numero);
    const w = arc.leggiLavoro(imp.Numero);
    const aperta = c != null && w != null && w.Fatte >= c.T;
    const inVigore = imp.Numero === s.Rom.CodiceInVigore && imp.MeseScadenza < 0;
    const siApre = imp.MeseCreazione + Rom.MESI_ATTESA;
    let st;
    let col;
    if (c == null) {
      st = 'capsula mancante!';
      col = 'Red';
    } else if (aperta) {
      if (inVigore && s.Rom.Liberato) { st = 'aperta · valida: ha liberato il dispositivo'; col = 'Green'; }
      else if (inVigore) { st = 'aperta · VALIDA: può liberare il dispositivo'; col = 'Green'; }
      else { st = 'aperta · scaduta (poi è arrivato ' + imp.ScadutoCon + ')'; col = 'DarkYellow'; }
    } else if (s.Mese < siApre) {
      st = 'sigillata · mancano ' + Mesi(siApre - s.Mese);
      if (w != null && w.Fatte > 0) st += ' · calcolo al ' + percento(w.Fatte, c.T) + '%';
      col = 'Gray';
    } else {
      st = 'sigillata · apribile ora (' + (inVigore ? 'codice in vigore' : 'codice scaduto') + ')';
      col = inVigore ? 'Cyan' : 'Gray';
    }
    x.Riga(col, Colonne('#' + imp.Numero, 'mese ' + imp.MeseCreazione, imp.Firmware ?? '', 'mese ' + siApre, st));
  }
  x.Riga();

  if (s.Rom.Liberato) {
    x.Riga('Green', '  Il «' + s.Nome + '» è LIBERO dal mese ' + s.MeseLiberazione + ': gira ' + s.Firmware + '.');
    x.Riga('Green', '  Il bootloader accetta qualunque firmware, per sempre.');
    x.Riga('DarkGray', '  Certificato: ' + Relativo(arc, arc.FileCertificato));
  } else if (s.Mese < apre) {
    const fatti = s.Mese - iv.MeseCreazione;
    x.Pezzo('Gray', '  Conto alla rovescia  [');
    x.Pezzo('Cyan', barraTesto(fatti, Rom.MESI_ATTESA, Rom.MESI_ATTESA));
    x.Riga('Gray', ']  ' + fatti + ' di ' + Rom.MESI_ATTESA + ' mesi senza aggiornamenti');
    x.Riga('  Se il produttore non rilascia altri aggiornamenti, la capsula #' + iv.Numero + ' si aprirà tra ' + Mesi(apre - s.Mese));
    x.Riga('  (mese ' + apre + ' · ' + Data(s, apre) + ') e chiunque potrà liberare il «' + s.Nome + '».');
    x.Riga('DarkGray', '  Ogni nuovo aggiornamento fa ripartire il conto da capo: finché il produttore se ne prende cura,');
    x.Riga('DarkGray', '  decide lui che cosa gira sul dispositivo.');
  } else {
    x.Pezzo('Gray', '  Conto alla rovescia  [');
    x.Pezzo('Cyan', barraTesto(1, 1, Rom.MESI_ATTESA));
    x.Riga('Gray', ']  finito: ' + Mesi(senza) + ' senza aggiornamenti');
    x.Riga('Cyan', '  La capsula #' + iv.Numero + ' è matura e contiene il codice in vigore.');
    x.Riga('Cyan', '  Chiunque può aprirla (testamento apri ' + iv.Numero + ') e liberare il «' + s.Nome + '».');
  }
  return OK;
}

// =====================================================================
// apri
// =====================================================================
function Apri(x, arc, arg) {
  const n = LeggiIntero(arg.replace(/^#+/, ''));
  if (n == null) throw new ErroreUtente('Quale capsula? Esempio:  testamento apri 1');
  const s = arc.leggiStato();
  const c = arc.leggiCapsula(n);
  if (c == null)
    throw new ErroreUtente('La capsula #' + n + ' non esiste. Questo dispositivo ne ha ' + s.Rom.Codici.length + ' (da 1 a ' + s.Rom.Codici.length + ').');

  let w = arc.leggiLavoro(n);
  if (w == null || w.Fatte < 0 || w.Fatte > c.T || !w.X) {
    w = { Numero: n, Fatte: 0, X: c.A, Secondi: 0, MeseApertura: -1 };
  }

  const apre = c.MeseCreazione + c.MesiAttesa;
  const trascorsi = s.Mese - c.MeseCreazione;
  const consentite = trascorsi >= c.MesiAttesa ? c.T : Math.floor(c.T * Math.max(0, trascorsi) / c.MesiAttesa);

  x.Riga();
  x.Riga('White', '  Capsula #' + n + ' · creata al mese ' + c.MeseCreazione + ' con il firmware ' + c.Firmware + ' · si apre al mese ' + apre);
  x.Riga('DarkGray', '  Puzzle RSW: ' + n0(c.T) + ' quadrature modulo N (' + c.BitModulo + " bit), una dopo l'altra.");
  x.Riga('DarkGray', '  Senza p e q (che la ROM ha dimenticato) non ci sono scorciatoie.');

  if (w.Fatte >= c.T) {
    x.Riga('DarkGray', '  Già aperta al mese ' + w.MeseApertura + ' dopo ' + dec(w.Secondi, 1) + ' s di calcolo: rileggo il risultato salvato.');
  } else {
    if (trascorsi < c.MesiAttesa) {
      x.Riga('  Sono passati ' + Mesi(Math.max(0, trascorsi)) + ' dei ' + c.MesiAttesa + ' necessari: il calcolo, partito quando la capsula è stata');
      x.Riga('  pubblicata, può essere arrivato solo al ' + percento(consentite, c.T) + '%.');
    }
    if (w.Fatte > 0)
      x.Riga('DarkGray', '  Riprendo il calcolo salvato: ' + n0(w.Fatte) + ' quadrature già fatte (' + percento(w.Fatte, c.T) + '%).');

    if (consentite > w.Fatte) {
      const daFare = consentite - w.Fatte;
      if (s.QuadratureAlSecondo > 0)
        x.Riga('DarkGray', '  Da calcolare adesso: ' + n0(daFare) + ' quadrature, circa ' + dec(daFare / s.QuadratureAlSecondo, 1) + ' s su questo PC.');
      try {
        Calcola(x, arc, c, w, consentite);
      } catch (e) {
        if (!(e instanceof Interrotto)) throw e;
        x.Riga();
        x.Riga('Yellow', '  Calcolo interrotto a ' + n0(w.Fatte) + ' quadrature (' + percento(w.Fatte, c.T) + '%).');
        x.Riga('DarkGray', '  Il lavoro è salvato in ' + Relativo(arc, arc.fileLavoro(n)) + ': si riprende da qui (testamento apri ' + n + ').');
        return RIFIUTATO;
      }
    } else {
      x.Riga('DarkGray', '  Il calcolo è già arrivato fin dove il calendario permette.');
      const ferma = new Barra(x, c.T, c.MesiAttesa);
      ferma.fine(w.Fatte, 0);
    }

    if (w.Fatte < c.T) {
      const mancano = c.T - w.Fatte;
      x.Riga();
      x.Riga('Yellow', '  Ancora sigillata: mancano ' + n0(mancano) + ' quadrature, cioè ' + Mesi(apre - s.Mese) + ' di calcolo.');
      x.Riga('  Non si può accelerare: ogni quadratura ha bisogno del risultato della precedente,');
      x.Riga('  quindi mille computer non vanno più veloci di uno.');
      x.Riga('DarkGray', '  Il lavoro è salvato in ' + Relativo(arc, arc.fileLavoro(n)) + ': si riprende da qui (testamento apri ' + n + ').');
      return RIFIUTATO;
    }
  }

  // Tutte le T quadrature sono fatte: x = b = a^(2^T) mod N.
  let codice;
  try {
    codice = c.apri(aBig(w.X));
    if (codice.length !== Codice.BYTE) throw new CapsulaManomessaException('il contenuto non è un codice da 128 bit');
  } catch (e) {
    if (!(e instanceof CapsulaManomessaException)) throw e;
    x.Riga();
    x.Riga('Red', '  CAPSULA MANOMESSA: ' + e.message + '.');
    x.Riga('Red', '  Il contenuto non è affidabile e non viene mostrato.');
    x.Riga('DarkGray', '  (Se sospetti del calcolo salvato, cancella ' + Relativo(arc, arc.fileLavoro(n)) + ' e ricalcola.)');
    return MANOMESSA;
  }
  if (w.MeseApertura < 0) {
    w.MeseApertura = s.Mese;
    arc.salvaLavoro(w);
  }

  const testo = Codice.formatta(codice);
  codice.fill(0);
  x.Riga('Green', '  Chiave = SHA-256(b) · HMAC-SHA256 verificato: la capsula è integra e la chiave è giusta.');
  x.Riga();
  x.Pezzo('Gray', '  Codice di liberazione #' + n + ':   ');
  x.Riga('White', testo);
  x.Riga();

  if (s.Rom.Liberato) {
    x.Riga('DarkGray', '  Il «' + s.Nome + '» è già libero dal mese ' + s.MeseLiberazione + '.');
  } else if (n === s.Rom.CodiceInVigore) {
    x.Riga('Green', '  Dopo questa capsula non è arrivato nessun aggiornamento: il codice è ancora in vigore.');
    x.Riga('Green', '  Per liberare il «' + s.Nome + '»:  testamento sblocca ' + testo);
  } else {
    x.Riga('Yellow', '  Dopo questa capsula il firmware è cambiato (' + c.Firmware + ' → ' + s.Firmware + '):');
    x.Riga('Yellow', '  per la regola della ROM questo codice è già scaduto.');
    x.Riga('DarkGray', '  Il dispositivo lo confermerà:  testamento sblocca ' + testo);
  }

  const f = [
    'Testamento · codice di liberazione pubblicato',
    '',
    'Dispositivo:  «' + s.Nome + '»',
    'Capsula:      #' + n + ', creata al mese ' + c.MeseCreazione + ' con il firmware ' + c.Firmware,
    'Aperta:       al mese ' + w.MeseApertura + ', dopo ' + n0(c.T) + ' quadrature sequenziali (' + dec(w.Secondi, 1) + ' s su questo PC)',
    'Codice:       ' + testo,
  ].map((r) => r + '\r\n').join('');
  Json.scriviTesto(arc.fileCodice(n), f, true);
  x.Riga('DarkGray', '  Il codice ora è pubblico: ' + Relativo(arc, arc.fileCodice(n)));
  return OK;
}

// Le quadrature vere, con barra di avanzamento e salvataggio periodico del lavoro.
function Calcola(x, arc, c, w, finoA) {
  const n = c.moduloN();
  let v = aBig(w.X);
  const partenza = w.Fatte;
  const secondiPrima = w.Secondi;
  const barra = new Barra(x, c.T, c.MesiAttesa);
  const inizio = performance.now();
  let ultimoSalvataggio = 0;
  let ultimoAvviso = -1;

  const salva = (fatte, corrente, t) => {
    w.Fatte = partenza + fatte;
    w.X = daBig(corrente);
    w.Secondi = secondiPrima + t;
    arc.salvaLavoro(w);
  };

  if (x.alProgresso) x.alProgresso(c.Numero, partenza, c.T, finoA);
  v = PuzzleRsw.quadrature(v, finoA - partenza, n, 2000, (fatte, corrente) => {
    barra.aggiorna(partenza + fatte);
    const t = (performance.now() - inizio) / 1000;
    if (t - ultimoSalvataggio >= 2.0) {
      ultimoSalvataggio = t;
      salva(fatte, corrente, t);
    }
    if (x.alProgresso && t - ultimoAvviso >= 0.1) {
      ultimoAvviso = t;
      x.alProgresso(c.Numero, partenza + fatte, c.T, finoA);
    }
    if (x.interrompi && fatte < finoA - partenza && x.interrompi()) {
      salva(fatte, corrente, t);
      barra.fine(partenza + fatte, t);
      throw new Interrotto();
    }
  });
  const durata = (performance.now() - inizio) / 1000;
  w.Fatte = finoA;
  w.X = daBig(v);
  w.Secondi = secondiPrima + durata;
  arc.salvaLavoro(w);
  if (x.alProgresso) x.alProgresso(c.Numero, finoA, c.T, finoA);
  barra.fine(finoA, durata);
}

// =====================================================================
// sblocca
// =====================================================================
function Sblocca(x, arc, testo) {
  if (testo.length === 0) throw new ErroreUtente('Serve il codice:  testamento sblocca 7F3A-19C2-...');
  const s = arc.leggiStato();
  x.Riga();
  if (s.Rom.Liberato) {
    x.Riga('Green', '  Il «' + s.Nome + '» è già libero dal mese ' + s.MeseLiberazione + ': il bootloader è SBLOCCATO.');
    return OK;
  }
  const codice = Codice.provaALeggere(testo);
  if (codice == null) {
    x.Riga('Red', '  Codice rifiutato: «' + testo + '» non è un codice di liberazione.');
    x.Riga('DarkGray', '  Un codice ha 32 cifre esadecimali (128 bit), per esempio 7F3A-19C2-0B6E-D451-8A2F-3C90-E7B1-5D04.');
    x.Riga('  Bootloader: resta BLOCCATO.');
    return RIFIUTATO;
  }

  // Novità Mac: dopo troppi codici falsi di fila il dispositivo fa aspettare, e l'attesa raddoppia.
  const tent = arc.leggiTentativi();
  const ora = x.ora();
  const prossimo = tent.ProssimoTentativo ? Date.parse(tent.ProssimoTentativo) : NaN;
  if (!Number.isNaN(prossimo) && ora < prossimo) {
    const attesa = Math.ceil((prossimo - ora) / 1000);
    x.Riga('Red', '  Tentativo rifiutato senza controllare il codice: ' + tent.CodiciFalsiDiFila + ' codici falsi di fila.');
    x.Riga('  Il dispositivo accetta il prossimo tentativo tra ' + DurataAttesa(attesa) + '.');
    x.Riga('  Bootloader: resta BLOCCATO.');
    x.Riga('DarkGray', "  L'attesa raddoppia a ogni codice falso: chi tira a indovinare non arriva da nessuna parte.");
    return RIFIUTATO;
  }

  x.Riga('  Il dispositivo calcola SHA-256(sale || codice) e lo confronta con le impronte nella ROM...');
  const { esito, trovato: imp } = Rom.verifica(s, codice);
  codice.fill(0);

  if (esito === Rom.Esito.Valido) {
    x.Riga('Green', "  Corrisponde all'impronta del codice #" + imp.Numero + ', quello in vigore.');
    x.Riga();
    x.Riga('Green', '  Bootloader: BLOCCATO → SBLOCCATO');
    s.Bootloader = SBLOCCATO;
    s.Rom.Liberato = true;
    s.MeseLiberazione = s.Mese;
    const cert = Certificato(s, imp);
    Json.scriviTesto(arc.FileCertificato, cert.replace(/\n/g, '\r\n'), true);
    arc.salvaStato(s);
    if (tent.CodiciFalsiDiFila > 0) arc.salvaTentativi({ CodiciFalsiDiFila: 0, ProssimoTentativo: null });
    x.Riga();
    for (const r of cert.split('\n')) x.Riga('Yellow', '  ' + r);
    x.Riga();
    x.Riga('DarkGray', '  Certificato salvato in ' + Relativo(arc, arc.FileCertificato));
    x.Riga('  Da ora il bootloader accetta qualunque firmware:  testamento installa "<firmware>"');
    return OK;
  }
  if (esito === Rom.Esito.Scaduto) {
    x.Riga('Red', '  Codice scaduto: il dispositivo è stato aggiornato dopo quella capsula (' + imp.Firmware + ' → ' + s.Firmware + ').');
    x.Riga('  È il codice #' + imp.Numero + ': valeva finché il firmware era ' + imp.Firmware + ', fino al mese ' + imp.MeseScadenza + ', quando è arrivato ' + imp.ScadutoCon + '.');
    x.Riga('  Bootloader: resta BLOCCATO.');
    x.Riga('DarkGray', '  Finché il produttore aggiorna, chi apre una capsula trova sempre un codice già scaduto.');
    return RIFIUTATO;
  }
  x.Riga('Red', '  Codice rifiutato: non corrisponde a nessun codice generato da questo dispositivo.');
  x.Riga('  Bootloader: resta BLOCCATO.');
  x.Riga('DarkGray', '  Tirare a indovinare è inutile: i codici possibili sono 2^128,');
  x.Riga('DarkGray', '  circa 340 miliardi di miliardi di miliardi di miliardi. Provandone mille miliardi al secondo');
  x.Riga('DarkGray', '  servirebbero in media ' + scientifico(Math.pow(2, 127) / 1e12 / SecondiInUnAnno()) + " anni (l'universo ne ha 1,4 × 10^10).");
  x.Riga('DarkGray', '  Per vederlo con i numeri di questo PC:  testamento indovina');

  const falsi = tent.CodiciFalsiDiFila + 1;
  let attesa = 0;
  if (falsi >= CODICI_FALSI_LIBERI) attesa = Math.min(ATTESA_MASSIMA_S, Math.pow(2, falsi - CODICI_FALSI_LIBERI));
  arc.salvaTentativi({
    CodiciFalsiDiFila: falsi,
    ProssimoTentativo: attesa > 0 ? new Date(ora + attesa * 1000).toISOString() : null,
  });
  if (attesa > 0)
    x.Riga('Yellow', '  Codici falsi di fila: ' + falsi + '. Prima del prossimo tentativo il dispositivo aspetta ' + DurataAttesa(attesa) + '.');
  return RIFIUTATO;
}

function DurataAttesa(secondi) {
  if (secondi < 60) return secondi === 1 ? '1 secondo' : secondi + ' secondi';
  const m = Math.ceil(secondi / 60);
  return m === 1 ? '1 minuto' : m + ' minuti';
}

function Certificato(s, imp) {
  const uff = UltimaUfficiale(s);
  const aggiornamenti = s.Storia.filter((v) => v.Ufficiale && v.Mese > 0).map((v) => v.Firmware);
  const senza = s.Mese - s.MeseUltimoAggiornamento;
  const linea = '═'.repeat(66);
  let b = '';
  b += '═'.repeat(19) + ' CERTIFICATO DI LIBERAZIONE ' + '═'.repeat(19) + '\n';
  b += 'Dispositivo                 «' + s.Nome + '»\n';
  b += 'Nato                        mese 0 (' + Data(s, 0) + ') con il firmware v1.0\n';
  b += 'Ultimo firmware ufficiale   ' + uff.Firmware + ', mese ' + uff.Mese + ' (' + Data(s, uff.Mese) + ')\n';
  b += 'Aggiornamenti ricevuti      ' + aggiornamenti.length + (aggiornamenti.length > 0 ? ' (' + aggiornamenti.join(', ') + ')' : '') + '\n';
  b += 'Liberato                    mese ' + s.Mese + ' (' + Data(s, s.Mese) + '), dopo ' + Mesi(senza) + ' senza aggiornamenti\n';
  b += 'Chiave                      codice #' + imp.Numero + ' dalla capsula #' + imp.Numero + ' · impronta ' + abbrevia(imp.Impronta) + '\n';
  b += '\n';
  b += 'Il produttore ha smesso di aggiornare questo dispositivo. Come\n';
  b += "prevede la sua ROM di avvio, il codice chiuso nell'ultima capsula\n";
  b += 'è diventato leggibile, e da oggi il bootloader accetta qualunque\n';
  b += 'firmware. Nessuno ha dovuto chiedere il permesso: è bastato il tempo.\n';
  b += linea;
  return b;
}

// =====================================================================
// certificato (novità Mac): esporta il certificato in .txt, .html e .json
// =====================================================================
const ESCAPE_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function html(t) { return String(t).replace(/[&<>"']/g, (c) => ESCAPE_HTML[c]); }

export function DatiCertificato(arc, s) {
  const imp = Rom.inVigore(s);
  let testo;
  if (fs.existsSync(arc.FileCertificato)) {
    testo = fs.readFileSync(arc.FileCertificato, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  } else {
    // Rigenerato com'era il giorno della liberazione.
    testo = Certificato(Object.assign({}, s, { Mese: s.MeseLiberazione }), imp);
  }
  const codice = arc.leggiCodicePubblicato(imp.Numero);
  let verificato = null;
  if (codice) {
    const b = Codice.provaALeggere(codice);
    verificato = daByte(Codice.impronta(aByte(imp.Sale), b)) === imp.Impronta;
  }
  const c = arc.leggiCapsula(imp.Numero);
  return {
    testo,
    json: {
      Formato: 'testamento-certificato-1',
      Dispositivo: s.Nome,
      Nascita: Data(s, 0),
      MeseLiberazione: s.MeseLiberazione,
      DataLiberazione: Data(s, s.MeseLiberazione),
      UltimoFirmwareUfficiale: UltimaUfficiale(s).Firmware,
      AggiornamentiRicevuti: s.Storia.filter((v) => v.Ufficiale && v.Mese > 0).map((v) => v.Firmware),
      Capsula: imp.Numero,
      BitModulo: c ? c.BitModulo : 0,
      QuadratureT: c ? c.T : 0,
      Sale: imp.Sale,
      Impronta: imp.Impronta,
      Codice: codice,
      ImprontaVerificata: verificato,
      ComeVerificare: 'SHA-256 dei 16 byte del sale seguiti dai 16 byte del codice (esadecimale) deve dare l\'impronta.',
    },
  };
}

function PaginaCertificato(d) {
  const j = d.json;
  const riga = (k, v) => '<tr><th scope="row">' + html(k) + '</th><td><code>' + html(v) + '</code></td></tr>';
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Certificato di liberazione · ${html(j.Dispositivo)}</title>
<style>
  :root { color-scheme: light; --inchiostro: #1d2433; --tenue: #5a6377; --bordo: #d5d9e2; --accento: #1f6f4a; }
  body { margin: 0; background: #f6f4ee; color: var(--inchiostro); font: 16px/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 48px; }
  .foglio { background: #fff; border: 1px solid var(--bordo); border-radius: 10px; padding: 28px 24px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  p.sotto { color: var(--tenue); margin: 0 0 20px; }
  pre { white-space: pre-wrap; word-break: break-word; font: 13px/1.45 ui-monospace, Menlo, monospace; background: #fbfaf6; border: 1px solid var(--bordo); border-radius: 8px; padding: 14px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
  th, td { text-align: left; vertical-align: top; padding: 8px 6px; border-top: 1px solid var(--bordo); }
  th { width: 34%; color: var(--tenue); font-weight: 600; }
  code { font: 12.5px ui-monospace, Menlo, monospace; word-break: break-all; }
  .esito { margin-top: 18px; padding: 10px 12px; border-radius: 8px; background: #e8f4ee; color: var(--accento); font-weight: 600; }
  .esito.no { background: #fbeaea; color: #8a1f1f; }
  @media print { body { background: #fff; } .foglio { border: 0; padding: 0; } }
</style>
</head>
<body>
<main>
<div class="foglio">
<h1>Certificato di liberazione</h1>
<p class="sotto">«${html(j.Dispositivo)}» · libero dal mese ${j.MeseLiberazione} (${html(j.DataLiberazione)})</p>
<pre>${html(d.testo)}</pre>
<table>
${riga('Capsula', '#' + j.Capsula + ' · N da ' + j.BitModulo + ' bit · T = ' + n0(j.QuadratureT) + ' quadrature')}
${riga('Sale', j.Sale)}
${riga('Impronta nella ROM', j.Impronta)}
${riga('Codice pubblicato', j.Codice || '(non pubblicato in questa cartella)')}
${riga('Come verificare', 'SHA-256(sale || codice) = impronta')}
</table>
${j.ImprontaVerificata === null ? '' : `<p class="esito${j.ImprontaVerificata ? '' : ' no'}">${j.ImprontaVerificata
    ? 'Verificato: SHA-256(sale || codice) coincide con l’impronta conservata nella ROM.'
    : 'Attenzione: il codice pubblicato NON coincide con l’impronta della ROM.'}</p>`}
</div>
</main>
</body>
</html>
`;
}

function EsportaCertificato(x, arc) {
  const s = arc.leggiStato();
  x.Riga();
  if (!s.Rom.Liberato) {
    x.Riga('Yellow', '  Il «' + s.Nome + '» non è ancora libero: non c\'è nessun certificato da esportare.');
    x.Riga('DarkGray', '  Il certificato nasce quando un codice valido sblocca il bootloader (testamento sblocca).');
    return RIFIUTATO;
  }
  const d = DatiCertificato(arc, s);
  if (!fs.existsSync(arc.FileCertificato)) Json.scriviTesto(arc.FileCertificato, d.testo.replace(/\n/g, '\r\n'), true);
  Json.scriviTesto(arc.FileCertificatoHtml, PaginaCertificato(d), false);
  Json.scriviTesto(arc.FileCertificatoJson, JSON.stringify(d.json, null, 2) + '\n', false);
  for (const r of d.testo.split('\n')) x.Riga('Yellow', '  ' + r);
  x.Riga();
  if (d.json.ImprontaVerificata === true)
    x.Riga('Green', '  Verifica: SHA-256(sale || codice #' + d.json.Capsula + ") coincide con l'impronta nella ROM.");
  else if (d.json.ImprontaVerificata === false)
    x.Riga('Red', "  Attenzione: il codice pubblicato per la capsula #" + d.json.Capsula + " non coincide con l'impronta nella ROM.");
  else
    x.Riga('DarkGray', '  (Il codice della capsula #' + d.json.Capsula + ' non è pubblicato in questa cartella: niente verifica.)');
  x.Riga('DarkGray', '  Esportato in ' + Relativo(arc, arc.FileCertificato) + ', ' + path.basename(arc.FileCertificatoHtml)
    + ' (da stampare) e ' + path.basename(arc.FileCertificatoJson) + '.');
  return OK;
}

// =====================================================================
// installa
// =====================================================================
function Installa(x, arc, firmware) {
  if (firmware.length === 0) throw new ErroreUtente('Serve il nome del firmware:  testamento installa "FirmwareLibero 1.0"');
  const s = arc.leggiStato();
  x.Riga();
  if (s.Bootloader !== SBLOCCATO) {
    x.Riga('Red', '  Installazione rifiutata: il bootloader è BLOCCATO.');
    x.Riga('  «' + firmware + '» non porta la firma del produttore,');
    x.Riga('  e oggi il «' + s.Nome + '» accetta solo firmware firmato.');
    const iv = Rom.inVigore(s);
    const apre = iv.MeseCreazione + Rom.MESI_ATTESA;
    if (s.Mese < apre)
      x.Riga('DarkGray', '  Se il produttore non aggiorna più, il codice per sbloccarlo uscirà dalla capsula #' + iv.Numero + '\n  al mese ' + apre + ' (tra ' + Mesi(apre - s.Mese) + ').');
    else
      x.Riga('DarkGray', '  La capsula #' + iv.Numero + ' è già matura: aprila (testamento apri ' + iv.Numero + ')\n  e usa il suo codice con  testamento sblocca.');
    return RIFIUTATO;
  }
  const prima = s.Firmware;
  s.Firmware = firmware;
  s.FirmwareUfficiale = false;
  AggiungiStoria(s, firmware, false);
  arc.salvaStato(s);
  x.Riga('Green', '  Firmware ' + prima + ' → ' + firmware);
  x.Riga('  Il bootloader è sbloccato: nessuna firma richiesta. Il «' + s.Nome + '» ora è LIBERO.');
  x.Riga('DarkGray', '  Può ricevere correzioni e funzioni nuove da chiunque, anche se il produttore non esiste più.');
  return OK;
}

// =====================================================================
// indovina: forza bruta vera, per qualche secondo
// =====================================================================
async function Indovina(x, arc, arg) {
  let secondi = 2;
  if (arg.length > 0) {
    const t = arg.replace(/,/g, '.');
    if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(t))
      throw new ErroreUtente("Durata non valida: '" + arg + "'. Esempio:  testamento indovina 3");
    secondi = Number(t);
  }
  secondi = Math.max(0.5, Math.min(60, secondi));
  const s = arc.leggiStato();
  const iv = Rom.inVigore(s);
  const sale = aByte(iv.Sale);
  const bersaglio = aByte(iv.Impronta);
  const fili = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;

  x.Riga();
  x.Riga('White', '  Provo a indovinare il codice #' + iv.Numero + ' per ' + dec(secondi, 1) + ' s, con ' + fili + ' processori logici in parallelo...');

  const inizio = performance.now();
  const scadenza = Date.now() + secondi * 1000;
  const risultati = await Promise.all(Array.from({ length: fili }, () => new Promise((risolvi, rifiuta) => {
    const w = new Worker(new URL('./indovina-lavoratore.mjs', import.meta.url), {
      workerData: { sale, bersaglio, scadenza },
    });
    w.once('message', risolvi);
    w.once('error', rifiuta);
  })));
  const durata = (performance.now() - inizio) / 1000;
  const totale = risultati.reduce((a, r) => a + r.mie, 0);
  const trovati = risultati.reduce((a, r) => a + r.trovati, 0);
  const ritmo = totale / durata;
  const anni = Math.pow(2, 127) / ritmo / SecondiInUnAnno();

  x.Riga('  Tentativi: ' + n0(totale) + ' in ' + dec(durata, 1) + ' s (' + n0(ritmo) + ' al secondo) · codici giusti trovati: ' + trovati);
  x.Riga('  Codici possibili: 2^128 = ' + raggruppa(2n ** 128n));
  x.Riga('  In media ne servono la metà, 2^127. A questo ritmo: ' + scientifico(anni) + ' anni.');
  x.Riga('  Con un miliardo di PC come questo: ' + scientifico(anni / 1e9) + " anni. L'universo ne ha 1,4 × 10^10.");
  x.Riga('Green', '  Aspettare è molto più veloce: al massimo ' + Rom.MESI_ATTESA + " mesi dall'ultimo aggiornamento.");
  return OK;
}

// =====================================================================
// taratura
// =====================================================================
export function QuadratureAlMese(x, bit = 1024) {
  const env = x.env.TESTAMENTO_QUADRATURE_AL_MESE;
  if (env) {
    const q = /^\s*[+-]?\d+\s*$/.test(env) ? Number(env.trim()) : NaN;
    if (!Number.isSafeInteger(q) || q < 1)
      throw new ErroreUtente("TESTAMENTO_QUADRATURE_AL_MESE non valida: '" + env + "'");
    return { qpm: q, qps: 0, origine: 'imposta da TESTAMENTO_QUADRATURE_AL_MESE' };   // velocità sconosciuta: niente stime in secondi
  }
  let t = Taratura.leggi(bit, x.env);
  let origine;
  if (t == null || !(t.QuadratureAlSecondo > 0)) {
    x.Riga();
    x.Riga('DarkGray', '  Prima esecuzione: misuro la velocità di questo PC...');
    t = Taratura.misura(1.5, bit);
    SalvaTaratura(x, t);
    origine = 'misurata ora, salvata in ' + Taratura.nomeTaratura(bit, x.env);
  } else {
    // Un portatile a batteria può andare a metà velocità: una prova breve
    // dice se la taratura salvata vale ancora.
    const prova = Taratura.misura(0.3, bit).QuadratureAlSecondo;
    const rapporto = prova / t.QuadratureAlSecondo;
    if (rapporto < 0.7 || rapporto > 1.3) {
      x.Riga();
      x.Riga('DarkGray', "  La velocità di questo PC è cambiata dall'ultima taratura (" + n0(t.QuadratureAlSecondo)
        + ' → circa ' + n0(prova) + ' quadrature/s): la rimisuro...');
      t = Taratura.misura(1.5, bit);
      SalvaTaratura(x, t);
      origine = 'rimisurata ora, salvata in ' + Taratura.nomeTaratura(bit, x.env);
    } else {
      origine = 'taratura del ' + t.Misurata + ', verificata ora';
    }
  }
  return {
    qps: t.QuadratureAlSecondo,
    qpm: Math.max(1, Math.round(t.QuadratureAlSecondo * SECONDI_PER_MESE)),
    origine,
  };
}

function SalvaTaratura(x, t) {
  try { Taratura.salva(t, x.env); }
  catch (e) { x.Riga('DarkGray', '  (non riesco a salvare la taratura: ' + e.message + ')'); }
}

function RifaiTaratura(x, bit) {
  x.Riga();
  x.Riga('DarkGray', '  Misuro la velocità di questo PC (1,5 s di quadrature modulo N da ' + bit + ' bit)...');
  const t = Taratura.misura(1.5, bit);
  SalvaTaratura(x, t);
  const qpm = Math.max(1, Math.round(t.QuadratureAlSecondo * SECONDI_PER_MESE));
  x.Riga('  ' + n0(t.QuadratureAlSecondo) + ' quadrature al secondo · 1 mese simulato = ' + n0(qpm) + ' quadrature ≈ ' + dec(SECONDI_PER_MESE, 1) + ' s');
  x.Riga('  Una capsula da ' + Rom.MESI_ATTESA + ' mesi: ' + n0(qpm * Rom.MESI_ATTESA) + ' quadrature, circa ' + dec(SECONDI_PER_MESE * Rom.MESI_ATTESA, 1) + ' s.');
  x.Riga('DarkGray', '  Salvata in ' + Taratura.fileTaratura(bit, x.env) + '. Vale per i dispositivi che nasceranno da ora in poi.');
  return OK;
}

// =====================================================================
// aiuto
// =====================================================================
function Aiuto(x) {
  x.Riga();
  x.Riga('White', "  TESTAMENTO — l'hardware che si libera da solo quando il produttore lo abbandona");
  x.Riga();
  x.Riga('  testamento nasce "<nome>"          nuovo dispositivo: firmware v1.0, bootloader bloccato, capsula #1');
  x.Riga('  testamento aggiorna <versione>     il produttore rilascia un aggiornamento: la ROM ruota il codice');
  x.Riga('  testamento tempo <mesi>            fa passare il tempo (simulato)');
  x.Riga('  testamento stato                   firmware, bootloader, capsule e conto alla rovescia');
  x.Riga('  testamento apri <n>                apre la capsula n facendo davvero le T quadrature');
  x.Riga('  testamento sblocca <codice>        prova un codice di liberazione');
  x.Riga('  testamento installa "<firmware>"   installa un firmware (solo a bootloader sbloccato)');
  x.Riga('  testamento indovina [secondi]      forza bruta vera per qualche secondo: per vedere quanto è inutile');
  x.Riga('  testamento taratura                rimisura la velocità di questo PC');
  x.Riga();
  x.Riga('DarkGray', '  Per tutti i comandi:  --dispositivo <cartella>  (oppure -Dispositivo; se manca: variabile');
  x.Riga('DarkGray', '  TESTAMENTO_DISPOSITIVO, altrimenti ./dispositivo)');
  x.Riga();
  x.Riga('DarkGray', '  Novità della versione Mac:');
  x.Riga('DarkGray', '  testamento certificato             esporta il certificato di liberazione (.txt, .html, .json)');
  x.Riga('DarkGray', '  testamento nasce "<nome>" --bit 2048   capsule con un modulo N da 2048 bit (taratura a parte)');
  x.Riga('DarkGray', '  testamento taratura 2048           rimisura la velocità con N da 2048 bit');
  x.Riga();
}

// =====================================================================
// Utilità
// =====================================================================
function AggiungiStoria(s, firmware, ufficiale) {
  s.Storia.push({ Mese: s.Mese, Firmware: firmware, Ufficiale: ufficiale });
}

export function UltimaUfficiale(s) {
  for (let i = s.Storia.length - 1; i >= 0; i--) if (s.Storia[i].Ufficiale) return s.Storia[i];
  return { Mese: 0, Firmware: 'v1.0', Ufficiale: true };
}

export function Data(s, mese) {
  return dataSimulata(s.AnnoNascita, s.MeseNascita, mese);
}

function SecondiInUnAnno() {
  return 365.25 * 24 * 3600;
}

function Relativo(arc, percorso) {
  const radice = arc.Radice.replace(/[\\/]+$/, '') + path.sep;
  if (percorso.toLowerCase().startsWith(radice.toLowerCase())) return percorso.substring(radice.length);
  return percorso;
}

function Campo(x, etichetta, valore, colore) {
  x.Pezzo('DarkGray', '  ' + etichetta.padEnd(22));
  x.Riga(colore, valore);
}

// ---------------------------------------------------------------------------
// Barra di avanzamento delle quadrature
// ---------------------------------------------------------------------------
class Barra {
  constructor(x, totale, mesi) {
    this.x = x;
    this.totale = totale;
    this.mesi = mesi;
    this.dalVivo = Boolean(x.uscita.dalVivo);
    this.inizio = performance.now();
    this.ultimoDisegno = -1000;
    this.lunghezzaPrecedente = 0;
    this.LARGHEZZA = 20;
  }

  aggiorna(fatte) {
    if (!this.dalVivo) return;
    const ora = performance.now() - this.inizio;
    if (ora - this.ultimoDisegno < 100) return;
    this.ultimoDisegno = ora;
    this.disegna(fatte, ora / 1000);
  }

  fine(fatte, secondi) {
    this.disegna(fatte, secondi);
    this.x.uscita.riga();
  }

  disegna(fatte, secondi) {
    const coda = '] ' + String(percento(fatte, this.totale)).padStart(3) + '%  '
      + dec(fatte * this.mesi / this.totale, 1) + '/' + this.mesi + ' mesi · '
      + n0(fatte) + ' quadrature · ' + dec(secondi, 1) + ' s';
    const lunghezza = 3 + this.LARGHEZZA + coda.length;
    if (this.dalVivo) this.x.uscita.scrivi('\r');
    this.x.Pezzo('Gray', '  [');
    this.x.Pezzo('Cyan', barraTesto(fatte, this.totale, this.LARGHEZZA));
    this.x.Pezzo('Gray', coda);
    if (this.dalVivo && lunghezza < this.lunghezzaPrecedente) this.x.uscita.scrivi(' '.repeat(this.lunghezzaPrecedente - lunghezza));
    this.lunghezzaPrecedente = lunghezza;
  }
}
