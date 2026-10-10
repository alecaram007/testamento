// TESTAMENTO - la crittografia vera del prototipo (port di src/Crittografia.cs).
//
//   Primi       numeri primi da 512 bit (Miller-Rabin, generatore casuale del sistema)
//   PuzzleRsw   puzzle a tempo di Rivest, Shamir e Wagner (1996)
//   Sigillo     chiave = SHA-256(b), cifratura AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC)
//   Capsula     il pacchetto pubblico: N, a, T e il codice cifrato
//   Codice      il codice di liberazione da 128 bit e la sua impronta salata
//
// Solo moduli integrati di Node: BigInt per l'aritmetica, node:crypto per il caso,
// SHA-256, HMAC e AES. I byte e i numeri finiscono su disco esattamente come nell'originale.

import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import {
  daByte, aByte, daBig, aBig, bigEndian, lunghezzaByte, byteABig, modPow, mcd,
  BYTE_CODICE, formattaCodice, provaALeggereCodice,
} from './puro.mjs';

export class CapsulaManomessaException extends Error {
  constructor(messaggio) { super(messaggio); this.name = 'CapsulaManomessaException'; }
}
export class InvalidOperationException extends Error {
  constructor(messaggio) { super(messaggio); this.name = 'InvalidOperationException'; }
}

// ---------------------------------------------------------------------------
// Numeri primi
// ---------------------------------------------------------------------------
function setaccio(limite) {
  const composto = new Uint8Array(limite + 1);
  const primi = [];
  for (let i = 2; i <= limite; i++) {
    if (composto[i]) continue;
    primi.push(i);
    for (let j = i * i; j <= limite; j += i) composto[j] = 1;
  }
  return primi.map(BigInt);
}
const PICCOLI = setaccio(2000);

export const Primi = {
  // Intero casuale di esattamente 'bit' bit (il bit più alto è sempre 1).
  casuale(bit) {
    const nb = Math.ceil(bit / 8);
    let v = byteABig(randomBytes(nb));
    v &= (1n << BigInt(bit)) - 1n;
    v |= 1n << BigInt(bit - 1);
    return v;
  },

  // Intero casuale in [0, limite), con distorsione trascurabile (64 bit in più).
  casualeSotto(limite) {
    if (limite <= 0n) throw new Error('limite non positivo');
    const b = randomBytes(lunghezzaByte(limite) + 8);
    return byteABig(b) % limite;
  },

  probabilmentePrimo(n, giri = 40) {
    if (n < 2n) return false;
    for (const p of PICCOLI) {
      if (n === p) return true;
      if (n % p === 0n) return false;
    }
    const nMeno1 = n - 1n;
    let d = nMeno1;
    let s = 0;
    while ((d & 1n) === 0n) { d >>= 1n; s++; }
    for (let g = 0; g < giri; g++) {
      const a = 2n + Primi.casualeSotto(n - 3n);              // base in [2, n-2]
      let x = modPow(a, d, n);
      if (x === 1n || x === nMeno1) continue;
      let testimone = true;
      for (let r = 1; r < s; r++) {
        x = (x * x) % n;
        if (x === nMeno1) { testimone = false; break; }
        if (x === 1n) break;
      }
      if (testimone) return false;                           // n è composto, di sicuro
    }
    return true;                                             // errore < 4^-giri
  },

  generaPrimo(bit) {
    for (;;) {
      let c = Primi.casuale(bit);
      c |= 1n << BigInt(bit - 2);   // i due bit alti a 1: p·q ha esattamente 2·bit bit
      c |= 1n;                      // dispari
      if (Primi.probabilmentePrimo(c, 40)) return c;
    }
  },
};

// ---------------------------------------------------------------------------
// Puzzle a tempo RSW
// ---------------------------------------------------------------------------
// Chi crea il puzzle conosce φ(N) e calcola b = a^(2^T) mod N in un attimo:
//     e = 2^T mod φ(N),   b = a^e mod N          (teorema di Eulero)
// Chi non conosce φ(N) deve fare T quadrature modulo N, una dopo l'altra:
// ogni passo ha bisogno del risultato del precedente, quindi più computer
// non aiutano. Trovare φ(N) equivale a fattorizzare N.
export class PuzzleRsw {
  constructor() {
    this.N = 0n;
    this.A = 0n;
    this.Phi = 0n;     // il segreto: esiste solo mentre la ROM sigilla la capsula
    this.T = 0;
  }

  static nuovo(bitPrimi, t) {
    if (!(t >= 1)) throw new Error('T deve essere almeno 1');
    const p = Primi.generaPrimo(bitPrimi);
    let q;
    do { q = Primi.generaPrimo(bitPrimi); } while (q === p);
    const z = new PuzzleRsw();
    z.N = p * q;
    z.Phi = (p - 1n) * (q - 1n);
    z.T = t;
    do { z.A = 2n + Primi.casualeSotto(z.N - 3n); } while (mcd(z.A, z.N) !== 1n);
    return z;
  }

  // Il ramo veloce: possibile solo conoscendo φ(N).
  risolviConSegreto() {
    if (this.Phi === 0n) throw new InvalidOperationException('il segreto è già stato dimenticato');
    return PuzzleRsw.risolviConPhi(this.A, this.T, this.Phi, this.N);
  }

  static risolviConPhi(a, t, phi, n) {
    const e = modPow(2n, BigInt(t), phi);
    return modPow(a, e, n);
  }

  // Dimentica φ(N). In JavaScript i BigInt sono immutabili e non si possono
  // azzerare in memoria: qui si butta il riferimento. Una ROM vera cancellerebbe i registri.
  dimentica() {
    this.Phi = 0n;
  }

  // Il ramo lento: 'quante' quadrature sequenziali, a partire da x.
  // 'ogni' viene chiamata ogni 'passo' quadrature con il totale fatto finora
  // e il valore corrente (serve per la barra, per salvare il lavoro e per interrompere).
  static quadrature(x, quante, n, passo, ogni) {
    if (passo < 1) passo = 1;
    let fatte = 0;
    while (fatte < quante) {
      const blocco = Math.min(passo, quante - fatte);
      for (let i = 0; i < blocco; i++) x = (x * x) % n;
      fatte += blocco;
      if (ogni) ogni(fatte, x);
    }
    return x;
  }

  static risolviLento(a, t, n) {
    return PuzzleRsw.quadrature(a, t, n, 1 << 20, null);
  }
}

// ---------------------------------------------------------------------------
// Cifratura della capsula
// ---------------------------------------------------------------------------
const ETICHETTA_AES = Buffer.from('testamento/chiave-aes', 'ascii');
const ETICHETTA_MAC = Buffer.from('testamento/chiave-hmac', 'ascii');

function hmac(chiave, ...parti) {
  const h = createHmac('sha256', chiave);
  for (const p of parti) h.update(p);
  return new Uint8Array(h.digest());
}

export const Sigillo = {
  // K = SHA-256(b), con b scritto in big-endian su tanti byte quanti ne ha N.
  chiaveDaB(b, byteModulo) {
    return new Uint8Array(createHash('sha256').update(bigEndian(b, byteModulo)).digest());
  },

  // Da K due chiavi indipendenti: una per AES-256, una per HMAC-SHA256.
  deriva(k) {
    return { kAes: hmac(k, ETICHETTA_AES), kMac: hmac(k, ETICHETTA_MAC) };
  },

  cifra(k, intestazione, chiaro) {
    const { kAes, kMac } = Sigillo.deriva(k);
    const iv = new Uint8Array(randomBytes(16));
    const c = createCipheriv('aes-256-cbc', kAes, iv);               // riempimento PKCS#7
    const cifrato = new Uint8Array(Buffer.concat([c.update(chiaro), c.final()]));
    const tag = Sigillo.mac(kMac, intestazione, iv, cifrato);
    return { iv, cifrato, tag };
  },

  decifra(k, intestazione, iv, cifrato, tag) {
    const { kAes, kMac } = Sigillo.deriva(k);
    const atteso = Sigillo.mac(kMac, intestazione, iv, cifrato);
    if (!Codice.uguali(atteso, tag))
      throw new CapsulaManomessaException('HMAC non valido: la capsula è stata alterata (o il calcolo che la apre è sbagliato)');
    const d = createDecipheriv('aes-256-cbc', kAes, iv);
    return new Uint8Array(Buffer.concat([d.update(cifrato), d.final()]));
  },

  // L'HMAC copre intestazione (numero, dispositivo, firmware, N, a, T...), IV e testo cifrato.
  // Davanti c'è la lunghezza dell'intestazione su 4 byte little-endian, come BitConverter.GetBytes(int) su un PC.
  mac(kMac, intestazione, iv, cifrato) {
    const lunghezza = Buffer.alloc(4);
    lunghezza.writeInt32LE(intestazione.length, 0);
    return hmac(kMac, lunghezza, intestazione, iv, cifrato);
  },
};

// ---------------------------------------------------------------------------
// La capsula: tutto ciò che contiene è pubblico
// ---------------------------------------------------------------------------
export const FORMATO_CAPSULA = 'testamento-capsula-1';

export class Capsula {
  constructor() {
    // L'ordine dei campi è quello del file capsula-N.json dell'originale.
    this.Formato = null;
    this.Numero = 0;
    this.Dispositivo = null;
    this.Firmware = null;
    this.MeseCreazione = 0;
    this.MesiAttesa = 0;
    this.BitModulo = 0;
    this.N = null;
    this.A = null;
    this.T = 0;
    this.Iv = null;
    this.Cifrato = null;
    this.Hmac = null;
  }

  static da(oggetto) {
    return Object.assign(new Capsula(), oggetto);
  }

  intestazione() {
    const s = [this.Formato, String(this.Numero), this.Dispositivo, this.Firmware, String(this.MeseCreazione),
      String(this.MesiAttesa), String(this.BitModulo), this.N, this.A, String(this.T)]
      .map((v) => (v == null ? '' : v)).join('|');
    return new Uint8Array(Buffer.from(s, 'utf8'));
  }

  moduloN() { return aBig(this.N); }
  baseA() { return aBig(this.A); }

  // Chiude 'codice' nella capsula usando il puzzle z (che deve conoscere ancora φ).
  static sigilla(z, codice, numero, dispositivo, firmware, meseCreazione, mesiAttesa) {
    const c = new Capsula();
    c.Formato = FORMATO_CAPSULA;
    c.Numero = numero;
    c.Dispositivo = dispositivo;
    c.Firmware = firmware;
    c.MeseCreazione = meseCreazione;
    c.MesiAttesa = mesiAttesa;
    c.BitModulo = lunghezzaByte(z.N) * 8;
    c.N = daBig(z.N);
    c.A = daBig(z.A);
    c.T = z.T;
    const b = z.risolviConSegreto();                       // il ramo veloce
    const k = Sigillo.chiaveDaB(b, c.BitModulo / 8);
    const { iv, cifrato, tag } = Sigillo.cifra(k, c.intestazione(), codice);
    k.fill(0);
    c.Iv = daByte(iv);
    c.Cifrato = daByte(cifrato);
    c.Hmac = daByte(tag);
    return c;
  }

  // Apre la capsula dato b = a^(2^T) mod N. Lancia CapsulaManomessaException se l'HMAC non torna.
  apri(b) {
    if (this.Formato !== FORMATO_CAPSULA) throw new CapsulaManomessaException('formato della capsula sconosciuto');
    const k = Sigillo.chiaveDaB(b, this.BitModulo / 8);
    return Sigillo.decifra(k, this.intestazione(), aByte(this.Iv), aByte(this.Cifrato), aByte(this.Hmac));
  }
}

// ---------------------------------------------------------------------------
// Il codice di liberazione
// ---------------------------------------------------------------------------
export const Codice = {
  BYTE: BYTE_CODICE,   // 128 bit

  nuovo() {
    return new Uint8Array(randomBytes(BYTE_CODICE));
  },

  formatta: formattaCodice,
  provaALeggere: provaALeggereCodice,

  // Impronta salata: SHA-256(sale || codice). È tutto ciò che il dispositivo conserva.
  impronta(sale, codice) {
    return new Uint8Array(createHash('sha256').update(sale).update(codice).digest());
  },

  // Confronto a tempo costante.
  uguali(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  },
};
