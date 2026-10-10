// 6 · Regressioni trovate in revisione: casi in cui il port si comportava
// diversamente dall'originale (src/*.cs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { T, cartellaDiProva, leggiStato } from './aiuto.mjs';

const prove = cartellaDiProva('revisione');
test.after(() => fs.rmSync(prove, { recursive: true, force: true }));

test('aggiorna funziona anche se il file della capsula in vigore è rovinato (l\'originale non lo legge)', () => {
  const d = path.join(prove, 'capsula rovinata');
  assert.equal(T(d, ['nasce', 'Rovinato']).codice, 0);
  fs.writeFileSync(path.join(d, 'capsule', 'capsula-1.json'), '{rotto');
  const o = T(d, ['aggiorna', '1.1']);
  assert.equal(o.codice, 0, o.testo);
  assert.match(o.testo, /codice #1 \(v1\.0\) → SCADUTO/);
  const s = leggiStato(d);
  assert.equal(s.Rom.CodiceInVigore, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'capsule', 'capsula-2.json'), 'utf8')).BitModulo, 1024);
});

test('i double nei JSON come double.ToString("R") di .NET Framework (JavaScriptSerializer)', async () => {
  const { serializza } = await import('../lib/dispositivo.mjs');
  // 15 cifre se bastano, altrimenti 17 (Node scriverebbe la forma più corta: 0.3333333333333333)
  assert.equal(serializza(1 / 3), '0.33333333333333331');
  assert.equal(serializza(0.1 + 0.7), '0.79999999999999993');
  assert.equal(serializza(0.1 + 0.2), '0.30000000000000004');
  assert.equal(serializza(11.7430957), '11.7430957');
  // esponente con almeno due cifre e la E maiuscola
  assert.equal(serializza(0.00001), '1E-05');
  assert.equal(serializza(1.2345e-7), '1.2345E-07');
  assert.equal(serializza(0.0001), '0.0001');
  assert.equal(serializza(1e21), '1E+21');
  // gli interi (int, long) restano cifra per cifra
  assert.equal(serializza(1009800), '1009800');
  assert.equal(serializza(-1), '-1');
  assert.equal(serializza(2 ** 52), '4503599627370496');
});

test('nelle stringhe JSON anche U+0085, U+2028 e U+2029 sono protetti, come JavaScriptSerializer', async () => {
  const { serializza } = await import('../lib/dispositivo.mjs');
  assert.equal(serializza('a\u0085b c d'), '"a\\u0085b\\u2028c\\u2029d"');
});
