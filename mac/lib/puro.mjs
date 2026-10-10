// TESTAMENTO - la parte "pura" del nucleo: esadecimale, BigInt, il formato del
// codice di liberazione e i numeri scritti all'italiana.
//
// Non importa nessun modulo node:*, quindi lo usa anche il browser
// (l'interfaccia web lo carica da /lib/puro.mjs per controllare i codici mentre li scrivi).

// ---------------------------------------------------------------------------
// Errori con lo stesso nome dei tipi .NET dell'originale
// ---------------------------------------------------------------------------
export class FormatException extends Error {
  constructor(messaggio) { super(messaggio); this.name = 'FormatException'; }
}
export class ArgumentException extends Error {
  constructor(messaggio) { super(messaggio); this.name = 'ArgumentException'; }
}

// ---------------------------------------------------------------------------
// Esadecimale e BigInt (come la classe Hex dell'originale)
// ---------------------------------------------------------------------------
const CIFRE_HEX = '0123456789ABCDEF';

// Byte → esadecimale MAIUSCOLO senza separatori (BitConverter.ToString(b).Replace("-", "")).
export function daByte(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += CIFRE_HEX[b[i] >> 4] + CIFRE_HEX[b[i] & 15];
  return s;
}

export function aByte(h) {
  if (typeof h !== 'string' || h.length % 2 !== 0) throw new FormatException('esadecimale non valido');
  const r = new Uint8Array(h.length / 2);
  for (let i = 0; i < r.length; i++) {
    const coppia = h.substr(2 * i, 2);
    if (!/^[0-9A-Fa-f]{2}$/.test(coppia)) throw new FormatException('esadecimale non valido');
    r[i] = parseInt(coppia, 16);
  }
  return r;
}

// Numero di byte significativi di un intero positivo (almeno 1).
export function lunghezzaByte(v) {
  if (v <= 0n) return 1;
  return Math.ceil(bitLength(v) / 8);
}

export function bitLength(v) {
  if (v < 0n) v = -v;
  return v === 0n ? 0 : v.toString(2).length;
}

// Intero → byte big-endian, su 'lunghezza' byte (con zeri davanti).
export function bigEndian(v, lunghezza) {
  if (v < 0n) throw new ArgumentException('numero negativo');
  let h = v.toString(16);
  if (h.length % 2) h = '0' + h;
  const nb = h.length / 2;
  if (nb > lunghezza) {
    // come l'originale: i byte in più devono essere zero, altrimenti è troppo grande
    if (v >> BigInt(8 * lunghezza) !== 0n) throw new ArgumentException('numero troppo grande');
  }
  const r = new Uint8Array(lunghezza);
  for (let i = 0; i < Math.min(nb, lunghezza); i++) {
    r[lunghezza - 1 - i] = parseInt(h.substr(h.length - 2 * (i + 1), 2), 16);
  }
  return r;
}

// Come nei file JSON dell'originale: big-endian, maiuscolo, byte interi, nessuno zero in più davanti.
export function daBig(v) {
  return daByte(bigEndian(v, lunghezzaByte(v)));
}

export function aBig(h) {
  const be = aByte(h);           // controlla il formato come l'originale
  if (be.length === 0) return 0n;
  return BigInt('0x' + daByte(be));
}

export function byteABig(b) {
  return b.length === 0 ? 0n : BigInt('0x' + daByte(b));
}

export function modPow(base, esp, mod) {
  if (mod === 1n) return 0n;
  let r = 1n;
  base %= mod;
  if (base < 0n) base += mod;
  while (esp > 0n) {
    if (esp & 1n) r = (r * base) % mod;
    esp >>= 1n;
    if (esp > 0n) base = (base * base) % mod;
  }
  return r;
}

export function mcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// ---------------------------------------------------------------------------
// Il codice di liberazione: 128 bit, scritto 7F3A-19C2-... (otto gruppi da quattro)
// ---------------------------------------------------------------------------
export const BYTE_CODICE = 16;

export function formattaCodice(c) {
  const h = daByte(c);
  const gruppi = [];
  for (let i = 0; i < h.length; i += 4) gruppi.push(h.substr(i, 4));
  return gruppi.join('-');
}

// Accetta trattini, spazi, trattini bassi, punti e minuscole. Servono esattamente 32 cifre esadecimali.
// Restituisce i 16 byte, oppure null.
export function provaALeggereCodice(testo) {
  if (testo == null) return null;
  let sb = '';
  for (const ch of String(testo)) {
    if (ch === '-' || ch === ' ' || ch === '_' || ch === '.') continue;
    if (/^[0-9A-Fa-f]$/.test(ch)) sb += ch.toUpperCase();
    else return null;
  }
  if (sb.length !== BYTE_CODICE * 2) return null;
  return aByte(sb);
}

export const RE_CODICE = /([0-9A-F]{4}-){7}[0-9A-F]{4}/;

// ---------------------------------------------------------------------------
// Numeri e date all'italiana (come CultureInfo "it-IT" in .NET)
// ---------------------------------------------------------------------------
export const MESI_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
  'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function raggruppaCifre(cifre) {
  let sb = '';
  for (let i = 0; i < cifre.length; i++) {
    if (i > 0 && (cifre.length - i) % 3 === 0) sb += '.';
    sb += cifre[i];
  }
  return sb;
}

// Math.Round di .NET: arrotondamento "del banchiere" (a metà va al pari).
export function arrotondaPari(v) {
  const r = Math.round(v);
  if (Math.abs(v % 1) === 0.5) return 2 * Math.round(v / 2);
  return r;
}

// N0: Math.Round(v).ToString("N0", it-IT) → 1.009.800
export function n0(v) {
  if (typeof v === 'bigint') return (v < 0n ? '-' : '') + raggruppaCifre((v < 0n ? -v : v).toString());
  const r = arrotondaPari(Number(v));
  if (!isFinite(r)) return String(r);
  const neg = r < 0;
  const cifre = BigInt(Math.abs(r)).toString();
  return (neg && r !== 0 ? '-' : '') + raggruppaCifre(cifre);
}

// Dec: v.ToString("N<cifre>", it-IT) → 11,6 · 1.234,5 (a metà si arrotonda lontano da zero)
export function dec(v, cifre) {
  v = Number(v);
  if (!isFinite(v)) return String(v);
  const neg = v < 0;
  const a = Number(Math.abs(v).toPrecision(15));
  const scala = 10 ** cifre;
  let intero = Math.floor(a * scala + 0.5 + 1e-9);
  if (intero === 0) return (cifre > 0 ? '0,' + '0'.repeat(cifre) : '0');
  const s = String(intero).padStart(cifre + 1, '0');
  const parteIntera = s.slice(0, s.length - cifre);
  const parteDecimale = s.slice(s.length - cifre);
  return (neg ? '-' : '') + raggruppaCifre(parteIntera) + (cifre > 0 ? ',' + parteDecimale : '');
}

export function percento(fatte, totale) {
  if (totale <= 0) return 100;
  return Math.floor(100 * Number(fatte) / Number(totale));
}

export function mesi(n) {
  return n === 1 ? '1 mese' : n + ' mesi';
}

// "ottobre 2026": il mese 'mese' dalla nascita (AnnoNascita, MeseNascita 1-12).
export function dataSimulata(annoNascita, meseNascita, mese) {
  const m0 = Math.max(1, Math.min(12, meseNascita)) - 1 + mese;
  const anno = annoNascita + Math.floor(m0 / 12);
  const m = ((m0 % 12) + 12) % 12;
  return MESI_IT[m] + ' ' + anno;
}

export function scientifico(v) {
  if (v < 1e6) return n0(v);
  let esp = Math.floor(Math.log10(v));
  let m = v / Math.pow(10, esp);
  if (m >= 9.95) { m /= 10; esp++; }
  return dec(m, 1) + ' × 10^' + esp;
}

// 2^128 → 340.282.366.920.938.463.463.374.607.431.768.211.456
export function raggruppa(v) {
  return raggruppaCifre(BigInt(v).toString());
}

export function abbrevia(hex) {
  if (hex == null || hex.length <= 16) return hex;
  return hex.substring(0, 12) + '…' + hex.substring(hex.length - 4);
}

export function barraTesto(fatte, totale, larghezza) {
  let pieni = totale <= 0 ? larghezza : Math.floor(larghezza * Number(fatte) / Number(totale));
  pieni = Math.max(0, Math.min(larghezza, pieni));
  return '█'.repeat(pieni) + '░'.repeat(larghezza - pieni);
}

// "v1.1" da "1.1", "V1.1" → "v1.1"; il resto resta com'è.
export function normalizzaVersione(v) {
  v = String(v).trim();
  if (v.length > 1 && (v[0] === 'v' || v[0] === 'V') && /\d/.test(v[1])) return 'v' + v.substring(1);
  if (v.length > 0 && /\d/.test(v[0])) return 'v' + v;
  return v;
}

// La versione successiva, per proporla nell'interfaccia: v1.2 → v1.3
export function versioneSuccessiva(v) {
  const m = /^v(\d+)\.(\d+)$/.exec(String(v || ''));
  if (!m) return 'v1.1';
  return 'v' + m[1] + '.' + (Number(m[2]) + 1);
}
