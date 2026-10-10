// 1 · Crittografia (port della prima parte di src/test.ps1): primi, puzzle RSW
// (ramo veloce con φ contro ramo lento con T quadrature), capsula, HMAC, formato del codice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Primi, PuzzleRsw, Capsula, Codice, CapsulaManomessaException, InvalidOperationException } from '../lib/crittografia.mjs';
import { lunghezzaByte, modPow, daByte, aBig, daBig, bigEndian, n0, dec, scientifico, raggruppa, dataSimulata } from '../lib/puro.mjs';
import { altera } from './aiuto.mjs';

test('Miller-Rabin: 2^127-1 è primo, 561 e (2^127-1)(2^61-1) no', () => {
  const m127 = 2n ** 127n - 1n;                         // primo di Mersenne
  const carmichael = 561n;                              // 3·11·17, inganna Fermat
  const composto = m127 * (2n ** 61n - 1n);
  assert.equal(Primi.probabilmentePrimo(m127, 40), true);
  assert.equal(Primi.probabilmentePrimo(carmichael, 40), false);
  assert.equal(Primi.probabilmentePrimo(composto, 40), false);
  // 561 inganna il test di Fermat in base 2: 2^560 ≡ 1 (mod 561)
  assert.equal(modPow(2n, 560n, 561n), 1n);
});

test('i primi generati hanno esattamente 512 bit e i due bit alti a 1', () => {
  const p = Primi.generaPrimo(512);
  assert.equal(p.toString(2).length, 512);
  assert.equal(p >> 510n, 3n);
  assert.equal(Primi.probabilmentePrimo(p, 40), true);
});

// Un puzzle vero con primi da 512 bit, condiviso dai test che seguono (come $z in test.ps1).
const t0 = performance.now();
const z = PuzzleRsw.nuovo(512, 20000);
const msPuzzle = Math.round(performance.now() - t0);
let lento20000 = null;

test(`N ha 1024 bit (p, q da 512 bit generati in ${msPuzzle} ms)`, () => {
  assert.equal(lunghezzaByte(z.N), 128);
});

test('p·q: φ(N) coerente (a^φ ≡ 1 mod N)', () => {
  assert.equal(modPow(z.A, z.Phi, z.N), 1n);
});

for (const T of [1, 2, 1000, 20000]) {
  test(`ramo veloce (con φ) = ramo lento, T = ${T}`, () => {
    z.T = T;
    const veloce = z.risolviConSegreto();
    const lento = PuzzleRsw.risolviLento(z.A, T, z.N);
    assert.equal(veloce, lento);
    assert.notEqual(lento, z.A);
    if (T === 20000) lento20000 = lento;
  });
}

test("calcolo interrotto a 7.000 e ripreso fino a 20.000 = calcolo tutto d'un fiato", () => {
  const meta = PuzzleRsw.quadrature(z.A, 7000, z.N, 1000, null);
  const ripreso = PuzzleRsw.quadrature(meta, 13000, z.N, 1000, null);
  assert.equal(ripreso, lento20000);
  // e passa dal testo esadecimale salvato su disco (capsula-N.lavoro.json) senza perdere nulla
  const ripresoDaDisco = PuzzleRsw.quadrature(aBig(daBig(meta)), 13000, z.N, 1000, null);
  assert.equal(ripresoDaDisco, lento20000);
});

test('la funzione di avanzamento riceve i totali giusti, ogni "passo" quadrature', () => {
  const visti = [];
  PuzzleRsw.quadrature(z.A, 2500, z.N, 1000, (fatte) => visti.push(fatte));
  assert.deepEqual(visti, [1000, 2000, 2500]);
});

// Capsula: sigilla con il ramo veloce, apre con il ramo lento
z.T = 20000;
const codice = Codice.nuovo();
const c = Capsula.sigilla(z, codice, 1, 'Prova', 'v1.0', 0, 18);
const b = PuzzleRsw.risolviLento(c.baseA(), c.T, c.moduloN());

test('la capsula restituisce il codice giusto', () => {
  assert.deepEqual(c.apri(b), codice);
});

test('nella capsula pubblica il codice non compare in chiaro', () => {
  assert.equal((c.N + c.A + c.Iv + c.Cifrato + c.Hmac).includes(daByte(codice)), false);
});

test('dopo dimentica() il ramo veloce non è più possibile', () => {
  const copia = Object.assign(new PuzzleRsw(), z);
  copia.dimentica();
  assert.throws(() => copia.risolviConSegreto(), InvalidOperationException);
});

test('capsula manomessa (un byte del cifrato cambiato): HMAC la rileva', () => {
  const m = Capsula.da({ ...c, Cifrato: altera(c.Cifrato) });
  assert.throws(() => m.apri(b), CapsulaManomessaException);
});

test('capsula manomessa (HMAC cambiato): rilevata', () => {
  const m = Capsula.da({ ...c, Hmac: altera(c.Hmac) });
  assert.throws(() => m.apri(b), CapsulaManomessaException);
});

test('capsula manomessa (intestazione: firmware cambiato): rilevata', () => {
  const m = Capsula.da({ ...c, Firmware: 'v9.9' });
  assert.throws(() => m.apri(b), CapsulaManomessaException);
});

test('capsula manomessa (IV cambiato, T cambiato, formato sconosciuto): rilevata', () => {
  assert.throws(() => Capsula.da({ ...c, Iv: altera(c.Iv) }).apri(b), CapsulaManomessaException);
  assert.throws(() => Capsula.da({ ...c, T: c.T + 1 }).apri(b), CapsulaManomessaException);
  assert.throws(() => Capsula.da({ ...c, Formato: 'altro' }).apri(b), CapsulaManomessaException);
});

test('una quadratura in meno (T-1): chiave sbagliata, HMAC la rileva', () => {
  const bSbagliato = PuzzleRsw.risolviLento(c.baseA(), c.T - 1, c.moduloN());
  assert.throws(() => c.apri(bSbagliato), CapsulaManomessaException);
});

test('capsula integra: si apre ancora', () => {
  assert.deepEqual(c.apri(b), codice);
});

test('formato del codice (7F3A-19C2-...) e rilettura', () => {
  const testo = Codice.formatta(codice);
  assert.match(testo, /^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);
  const riletto = Codice.provaALeggere(testo.toLowerCase().replaceAll('-', ' '));
  assert.deepEqual(riletto, codice);
  assert.deepEqual(Codice.provaALeggere(testo.replaceAll('-', '_')), codice);
});

test('rilettura rifiuta testo non esadecimale e codici corti', () => {
  const testo = Codice.formatta(codice);
  assert.equal(Codice.provaALeggere('ciao'), null);
  assert.equal(Codice.provaALeggere(testo.substring(0, 38)), null);
  assert.equal(Codice.provaALeggere(testo + '0'), null);
});

test('impronta salata = SHA-256(sale || codice) e confronto a tempo costante', () => {
  const sale = new Uint8Array(16).fill(7);
  const a = Codice.impronta(sale, codice);
  assert.equal(a.length, 32);
  assert.equal(Codice.uguali(a, Codice.impronta(sale, codice)), true);
  assert.equal(Codice.uguali(a, Codice.impronta(new Uint8Array(16), codice)), false);
  assert.equal(Codice.uguali(a, a.subarray(0, 31)), false);
});

test('esadecimale come l\'originale: big-endian, maiuscolo, byte interi', () => {
  assert.equal(daBig(0n), '00');
  assert.equal(daBig(255n), 'FF');
  assert.equal(daBig(256n), '0100');
  assert.equal(aBig('00FF'), 255n);
  assert.deepEqual([...bigEndian(1n, 4)], [0, 0, 0, 1]);
  assert.throws(() => bigEndian(65536n, 2));
  assert.throws(() => aBig('ABC'));
  assert.throws(() => aBig('ZZ'));
});

test('numeri e date all\'italiana come CultureInfo it-IT', () => {
  assert.equal(n0(1009800), '1.009.800');
  assert.equal(n0(93500), '93.500');
  assert.equal(n0(999), '999');
  assert.equal(dec(11.6236846, 1), '11,6');
  assert.equal(dec(0.04, 1), '0,0');
  assert.equal(dec(1234.56, 1), '1.234,6');
  assert.equal(scientifico(Math.pow(2, 127) / 1e12 / (365.25 * 24 * 3600)), '5,4 × 10^18');
  assert.equal(raggruppa(2n ** 128n), '340.282.366.920.938.463.463.374.607.431.768.211.456');
  assert.equal(dataSimulata(2026, 10, 0), 'ottobre 2026');
  assert.equal(dataSimulata(2026, 10, 32), 'giugno 2029');
  assert.equal(dataSimulata(2026, 10, 12), 'ottobre 2027');
});
