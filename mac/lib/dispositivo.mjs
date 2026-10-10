// TESTAMENTO - il dispositivo simulato: stato, ROM di avvio, archivio su disco
// (port di src/Dispositivo.cs).
//
// I file JSON sono scritti come li scriveva l'originale con JavaScriptSerializer
// più la sua indentazione: due spazi, "chiave": valore, righe chiuse da CRLF,
// UTF-8 senza BOM, stesso ordine dei campi, stessi caratteri protetti con \uXXXX.
// Così una cartella creata su Windows si apre su Mac e viceversa.

import fs from 'node:fs';
import path from 'node:path';
import { PuzzleRsw, Capsula, Codice } from './crittografia.mjs';
import { daByte, aByte } from './puro.mjs';

export class ErroreUtente extends Error {
  constructor(messaggio) { super(messaggio); this.name = 'ErroreUtente'; }
}

// ---------------------------------------------------------------------------
// Gli schemi dei file (l'ordine dei campi è quello delle classi C#)
// ---------------------------------------------------------------------------
// tipi: 's' stringa, 'i' intero, 'l' intero lungo, 'd' double, 'b' booleano,
//       {oggetto: schema}, {lista: schema}
export const SCHEMI = {};
SCHEMI.ImprontaCodice = [
  ['Numero', 'i'], ['Firmware', 's'], ['MeseCreazione', 'i'], ['Sale', 's'], ['Impronta', 's'],
  ['MeseScadenza', 'i'], ['ScadutoCon', 's'],
];
SCHEMI.VoceStoria = [['Mese', 'i'], ['Firmware', 's'], ['Ufficiale', 'b']];
SCHEMI.RegistroRom = [['CodiceInVigore', 'i'], ['Liberato', 'b'], ['Codici', { lista: SCHEMI.ImprontaCodice }]];
SCHEMI.StatoDispositivo = [
  ['Formato', 's'], ['Nome', 's'], ['AnnoNascita', 'i'], ['MeseNascita', 'i'], ['Mese', 'i'],
  ['Firmware', 's'], ['FirmwareUfficiale', 'b'], ['MeseUltimoAggiornamento', 'i'], ['Bootloader', 's'],
  ['MeseLiberazione', 'i'], ['QuadratureAlMese', 'l'], ['QuadratureAlSecondo', 'd'],
  ['Rom', { oggetto: SCHEMI.RegistroRom }], ['Storia', { lista: SCHEMI.VoceStoria }],
];
SCHEMI.LavoroCapsula = [['Numero', 'i'], ['Fatte', 'l'], ['X', 's'], ['Secondi', 'd'], ['MeseApertura', 'i']];
SCHEMI.Taratura = [['QuadratureAlSecondo', 'd'], ['BitModulo', 'i'], ['Misurata', 's']];
SCHEMI.Capsula = [
  ['Formato', 's'], ['Numero', 'i'], ['Dispositivo', 's'], ['Firmware', 's'], ['MeseCreazione', 'i'],
  ['MesiAttesa', 'i'], ['BitModulo', 'i'], ['N', 's'], ['A', 's'], ['T', 'l'], ['Iv', 's'],
  ['Cifrato', 's'], ['Hmac', 's'],
];
// Novità della versione Mac, in file a parte (l'originale non li legge e non ne è disturbato).
SCHEMI.Tentativi = [['CodiciFalsiDiFila', 'i'], ['ProssimoTentativo', 's']];
SCHEMI.Cruscotto = [['ProduttoreFallito', 'b'], ['MeseFallimento', 'i']];

function erroreTipo(campo) {
  return new Error("valore non valido per '" + campo + "'");
}

// Da JSON grezzo a oggetto con tutti i campi dello schema, nell'ordine giusto.
// Come JavaScriptSerializer: i nomi si confrontano senza badare alle maiuscole,
// i campi mancanti prendono il valore predefinito, quelli sconosciuti si ignorano.
export function normalizza(schema, grezzo) {
  if (grezzo === null || grezzo === undefined) return null;
  if (typeof grezzo !== 'object' || Array.isArray(grezzo)) throw new Error('atteso un oggetto JSON');
  const chiavi = new Map();
  for (const k of Object.keys(grezzo)) chiavi.set(k.toLowerCase(), k);
  const r = {};
  for (const [nome, tipo] of schema) {
    const k = chiavi.get(nome.toLowerCase());
    const v = k === undefined ? undefined : grezzo[k];
    r[nome] = converti(nome, tipo, v);
  }
  return r;
}

function converti(nome, tipo, v) {
  if (typeof tipo === 'object') {
    if (v === undefined || v === null) return null;
    if (tipo.oggetto) return normalizza(tipo.oggetto, v);
    if (!Array.isArray(v)) throw erroreTipo(nome);
    return v.map((e) => normalizza(tipo.lista, e));
  }
  switch (tipo) {
    case 's':
      if (v === undefined || v === null) return null;
      if (typeof v === 'object') throw erroreTipo(nome);
      return String(v);
    case 'b':
      if (v === undefined || v === null) return false;
      if (typeof v === 'boolean') return v;
      if (v === 'true' || v === 'True') return true;
      if (v === 'false' || v === 'False') return false;
      throw erroreTipo(nome);
    case 'i':
    case 'l': {
      if (v === undefined || v === null) return 0;
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isInteger(n)) throw erroreTipo(nome);
      if (tipo === 'i' && (n > 2147483647 || n < -2147483648)) throw erroreTipo(nome);
      return n;
    }
    case 'd': {
      if (v === undefined || v === null) return 0;
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || Number.isNaN(n)) throw erroreTipo(nome);
      return n;
    }
    default:
      return v;
  }
}

// ---------------------------------------------------------------------------
// JSON leggibile, nello stesso formato dell'originale
// ---------------------------------------------------------------------------
const A_CAPO = '\r\n';

// Le stringhe come le scrive JavaScriptSerializer: protegge anche < > ' & con \uXXXX.
function stringaJson(s) {
  let r = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    switch (ch) {
      case '"': r += '\\"'; break;
      case '\\': r += '\\\\'; break;
      case '\b': r += '\\b'; break;
      case '\f': r += '\\f'; break;
      case '\n': r += '\\n'; break;
      case '\r': r += '\\r'; break;
      case '\t': r += '\\t'; break;
      case '<': case '>': case '\'': case '&':
      case '\u0085': case ' ': case ' ':     // anche gli a capo Unicode (HttpUtility.JavaScriptStringEncode)
        r += '\\u' + c.toString(16).padStart(4, '0'); break;
      default:
        if (c < 0x20) r += '\\u' + c.toString(16).padStart(4, '0');
        else r += ch;
    }
  }
  return r + '"';
}

// I double come double.ToString("R") di .NET Framework (quello che usa JavaScriptSerializer):
// 15 cifre significative se bastano a rileggere lo stesso numero, altrimenti 17;
// notazione esponenziale (1E-05, 1E+21) se l'esponente decimale è < -4 o >= delle cifre.
// Gli interi (int e long dell'originale, e i double senza decimali di Testamento) restano cifra per cifra.
function numeroJson(v) {
  if (!isFinite(v)) throw new Error('numero non rappresentabile in JSON');
  if (v === 0) return '0';
  if (Number.isSafeInteger(v)) return String(v);
  let cifreMax = 15;
  if (Number(v.toPrecision(15)) !== v) cifreMax = 17;
  const [mantissa, esponente] = Math.abs(v).toExponential(cifreMax - 1).split('e');
  const cifre = mantissa.replace('.', '').replace(/0+$/, '');
  const scala = Number(esponente) + 1;                   // posizione della virgola
  let r;
  if (scala > cifreMax || scala < -3) {
    const e = scala - 1;
    r = cifre[0] + (cifre.length > 1 ? '.' + cifre.substring(1) : '') + 'E' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
  } else if (scala <= 0) {
    r = '0.' + '0'.repeat(-scala) + cifre;
  } else if (cifre.length <= scala) {
    r = cifre + '0'.repeat(scala - cifre.length);
  } else {
    r = cifre.substring(0, scala) + '.' + cifre.substring(scala);
  }
  return (v < 0 ? '-' : '') + r;
}

export function serializza(v, livello = 0) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return stringaJson(v);
  if (typeof v === 'number') return numeroJson(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const rientro = (n) => ' '.repeat(n * 2);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '[' + A_CAPO + v.map((e) => rientro(livello + 1) + serializza(e, livello + 1)).join(',' + A_CAPO)
      + A_CAPO + rientro(livello) + ']';
  }
  const chiavi = Object.keys(v).filter((k) => typeof v[k] !== 'function');
  if (chiavi.length === 0) return '{}';
  return '{' + A_CAPO + chiavi.map((k) => rientro(livello + 1) + stringaJson(k) + ': ' + serializza(v[k], livello + 1))
    .join(',' + A_CAPO) + A_CAPO + rientro(livello) + '}';
}

export const Json = {
  leggi(percorso, schema) {
    let testo = fs.readFileSync(percorso, 'utf8');
    if (testo.charCodeAt(0) === 0xFEFF) testo = testo.slice(1);
    try {
      return normalizza(schema, JSON.parse(testo));
    } catch (e) {
      throw new ErroreUtente("File JSON illeggibile: '" + percorso + "' (" + e.message + ')');
    }
  },

  // Scrive l'oggetto rispettando l'ordine dello schema.
  scrivi(percorso, schema, o) {
    const ordinato = normalizza(schema, JSON.parse(JSON.stringify(o)));
    Json.scriviTesto(percorso, serializza(ordinato) + A_CAPO, false);
  },

  // Scrittura atomica: prima un file temporaneo, poi lo scambio.
  scriviTesto(percorso, testo, bom) {
    const tmp = percorso + '.tmp';
    fs.writeFileSync(tmp, (bom ? '﻿' : '') + testo, 'utf8');
    fs.renameSync(tmp, percorso);
  },
};

// ---------------------------------------------------------------------------
// La ROM di avvio
// ---------------------------------------------------------------------------
// Scritta in fabbrica e immutabile: nessun aggiornamento può cambiarne il
// comportamento. Il firmware del produttore non vede mai i codici: la ROM
// li genera, ne conserva solo l'impronta salata e li chiude in una capsula.
export const Rom = {
  MESI_ATTESA: 18,
  BIT_PRIMI: 512,          // N da 1024 bit (con --bit 2048: primi da 1024 bit)

  Esito: { Valido: 'Valido', Scaduto: 'Scaduto', Falso: 'Falso' },

  // Chiamata alla nascita e a ogni cambio di firmware ufficiale.
  nuovoTestamento(s, firmware, bitPrimi = Rom.BIT_PRIMI) {
    const inizio = performance.now();
    const r = { capsula: null, impronta: null, scaduto: null, secondi: 0 };
    const numero = s.Rom.Codici.length + 1;

    const codice = Codice.nuovo();                           // il generatore casuale del chip
    const sale = Codice.nuovo();                             // 16 byte di sale

    const t = Rom.MESI_ATTESA * s.QuadratureAlMese;
    const z = PuzzleRsw.nuovo(bitPrimi, t);
    r.capsula = Capsula.sigilla(z, codice, numero, s.Nome, firmware, s.Mese, Rom.MESI_ATTESA);
    z.dimentica();                                           // p, q e φ(N) spariscono

    const imp = {
      Numero: numero,
      Firmware: firmware,
      MeseCreazione: s.Mese,
      Sale: daByte(sale),
      Impronta: daByte(Codice.impronta(sale, codice)),
      MeseScadenza: -1,
      ScadutoCon: null,
    };
    codice.fill(0);                                          // e anche il codice

    for (const v of s.Rom.Codici) {
      if (v.MeseScadenza < 0) {
        v.MeseScadenza = s.Mese;
        v.ScadutoCon = firmware;
        r.scaduto = v;
      }
    }
    s.Rom.Codici.push(imp);
    s.Rom.CodiceInVigore = numero;
    r.impronta = imp;
    r.secondi = (performance.now() - inizio) / 1000;
    return r;
  },

  // Confronta il codice con tutte le impronte. Solo quella in vigore sblocca;
  // le altre servono a spiegare perché un codice vecchio non vale più.
  verifica(s, codice) {
    let trovato = null;
    for (const v of s.Rom.Codici) {
      const calcolata = Codice.impronta(aByte(v.Sale), codice);
      if (Codice.uguali(calcolata, aByte(v.Impronta))) trovato = v;
    }
    if (trovato == null) return { esito: Rom.Esito.Falso, trovato };
    if (trovato.Numero === s.Rom.CodiceInVigore && trovato.MeseScadenza < 0) return { esito: Rom.Esito.Valido, trovato };
    return { esito: Rom.Esito.Scaduto, trovato };
  },

  inVigore(s) {
    for (const v of s.Rom.Codici) if (v.Numero === s.Rom.CodiceInVigore) return v;
    return null;
  },
};

// ---------------------------------------------------------------------------
// La cartella del dispositivo
// ---------------------------------------------------------------------------
//   dispositivo.json               stato, compreso il registro della ROM (solo impronte)
//   capsule/capsula-N.json         la capsula pubblica: N, a, T, codice cifrato
//   capsule/capsula-N.lavoro.json  quante quadrature sono state fatte finora
//   capsule/capsula-N.codice.txt   il codice, dopo che qualcuno ha aperto la capsula
//   certificato-di-liberazione.txt
//   tentativi.json                 (novità Mac) i codici falsi di fila e l'attesa imposta
export const FORMATO_DISPOSITIVO = 'testamento-dispositivo-1';

export class Archivio {
  constructor(radice) {
    this.Radice = path.resolve(radice);
    this.FileStato = path.join(this.Radice, 'dispositivo.json');
    this.CartellaCapsule = path.join(this.Radice, 'capsule');
    this.FileCertificato = path.join(this.Radice, 'certificato-di-liberazione.txt');
    this.FileCertificatoHtml = path.join(this.Radice, 'certificato-di-liberazione.html');
    this.FileCertificatoJson = path.join(this.Radice, 'certificato-di-liberazione.json');
    this.FileTentativi = path.join(this.Radice, 'tentativi.json');
    this.FileCruscotto = path.join(this.Radice, 'cruscotto.json');
  }

  esiste() { return fs.existsSync(this.FileStato) && fs.statSync(this.FileStato).isFile(); }

  fileCapsula(n) { return path.join(this.CartellaCapsule, 'capsula-' + n + '.json'); }
  fileLavoro(n) { return path.join(this.CartellaCapsule, 'capsula-' + n + '.lavoro.json'); }
  fileCodice(n) { return path.join(this.CartellaCapsule, 'capsula-' + n + '.codice.txt'); }

  leggiStato() {
    if (!this.esiste())
      throw new ErroreUtente("Nessun dispositivo in '" + this.Radice + "'. Fallo nascere con:  testamento nasce \"<nome>\"");
    const s = Json.leggi(this.FileStato, SCHEMI.StatoDispositivo);
    if (s == null || s.Formato !== FORMATO_DISPOSITIVO || s.Rom == null || s.Rom.Codici == null)
      throw new ErroreUtente("'" + this.FileStato + "' non è uno stato di Testamento valido.");
    if (s.Storia == null) s.Storia = [];
    return s;
  }

  salvaStato(s) {
    fs.mkdirSync(this.Radice, { recursive: true });
    Json.scrivi(this.FileStato, SCHEMI.StatoDispositivo, s);
  }

  salvaCapsula(c) {
    fs.mkdirSync(this.CartellaCapsule, { recursive: true });
    Json.scrivi(this.fileCapsula(c.Numero), SCHEMI.Capsula, c);
  }

  leggiCapsula(n) {
    const f = this.fileCapsula(n);
    if (!fs.existsSync(f)) return null;
    const o = Json.leggi(f, SCHEMI.Capsula);
    return o == null ? null : Capsula.da(o);
  }

  leggiLavoro(n) {
    const f = this.fileLavoro(n);
    if (!fs.existsSync(f)) return null;
    return Json.leggi(f, SCHEMI.LavoroCapsula);
  }

  salvaLavoro(w) {
    fs.mkdirSync(this.CartellaCapsule, { recursive: true });
    Json.scrivi(this.fileLavoro(w.Numero), SCHEMI.LavoroCapsula, w);
  }

  // Il codice pubblicato da chi ha aperto la capsula n (o null).
  leggiCodicePubblicato(n) {
    const f = this.fileCodice(n);
    if (!fs.existsSync(f)) return null;
    const m = /([0-9A-F]{4}-){7}[0-9A-F]{4}/.exec(fs.readFileSync(f, 'utf8'));
    return m ? m[0] : null;
  }

  leggiTentativi() {
    const vuoto = { CodiciFalsiDiFila: 0, ProssimoTentativo: null };
    if (!fs.existsSync(this.FileTentativi)) return vuoto;
    try { return Json.leggi(this.FileTentativi, SCHEMI.Tentativi) || vuoto; } catch { return vuoto; }
  }

  salvaTentativi(t) {
    fs.mkdirSync(this.Radice, { recursive: true });
    Json.scrivi(this.FileTentativi, SCHEMI.Tentativi, t);
  }

  leggiCruscotto() {
    const vuoto = { ProduttoreFallito: false, MeseFallimento: -1 };
    if (!fs.existsSync(this.FileCruscotto)) return vuoto;
    try { return Json.leggi(this.FileCruscotto, SCHEMI.Cruscotto) || vuoto; } catch { return vuoto; }
  }

  salvaCruscotto(c) {
    fs.mkdirSync(this.Radice, { recursive: true });
    Json.scrivi(this.FileCruscotto, SCHEMI.Cruscotto, c);
  }
}
