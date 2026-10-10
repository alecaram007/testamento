// 8 · La pagina (web/app.mjs): controlli sul codice per difetti visti in Chrome headless.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');

test('da tastiera «Apri» non fa perdere il fuoco: dopo il ridisegno delle capsule torna nella stessa capsula', () => {
  // prima la lista si ricreava da capo e il fuoco finiva sul body: per arrivare a «Interrompi» si ripartiva dall'inizio
  const corpo = /function disegnaCapsule\(st\) \{([\s\S]*?)\n\}\n/.exec(app)[1];
  assert.match(corpo, /const fuoco = lista\.contains\(document\.activeElement\) \? document\.activeElement\.closest\('li'\)\?\.id : null;\n  lista\.innerHTML = '';/);
  assert.match(corpo, /if \(fuoco\) document\.querySelector\('#' \+ fuoco \+ ' button'\)\?\.focus\(\);\s*$/);
});

test('linea del tempo: «il produttore fallisce» vicino al bordo destro non esce dal disegno', () => {
  // prima la scritta partiva sempre a destra della linea: con il fallimento al mese 96 finiva a x=955 su 900 ed era tagliata
  assert.match(app, /const aSinistra = xf > W - 130;/);
  assert.match(app, /x: aSinistra \? xf - 4 : xf \+ 4, y: 12, 'text-anchor': aSinistra \? 'end' : 'start', class: 'testo-fallimento'/);
});

test('a 375 px una versione lunga senza spazi (40 caratteri) non allarga la pagina', () => {
  // prima titolo, stato e riga della capsula non andavano a capo: scrollWidth 587 su 375
  const css = fs.readFileSync(new URL('../web/stile.css', import.meta.url), 'utf8');
  assert.match(css, /\.capsula-titolo \{[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.capsula-meta \{[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.capsula \.chip \{ white-space: normal; overflow-wrap: anywhere; \}/);
});

test('senza dispositivo «Nuovo dispositivo» è davvero nascosto: .pulsante non vince sull\'attributo hidden', () => {
  // prima display:flex di .pulsante batteva [hidden]: il pulsante restava visibile anche senza dispositivo
  const css = fs.readFileSync(new URL('../web/stile.css', import.meta.url), 'utf8');
  assert.match(css, /\.pulsante\[hidden\][^{]*\{ display: none; \}/);
});

test('niente testo tagliato: la scelta del modulo N e la nota del conto alla rovescia', () => {
  const css = fs.readFileSync(new URL('../web/stile.css', import.meta.url), 'utf8');
  // prima il campo da 180 px tagliava «1024 bit (come l'originale)» in «1024 bit (come l'or»
  assert.match(css, /\.campo\.stretto:has\(select\) \{ flex-basis: auto; \}/);
  // un nome di 60 caratteri senza spazi nella nota «Il «…» è libero…» allargava la pagina a 375 px
  assert.match(css, /\.conto \{[^}]*overflow-wrap: anywhere;/);
});
