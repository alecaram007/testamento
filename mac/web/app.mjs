// TESTAMENTO · cruscotto web.
// Parla con server.mjs (API JSON + Server-Sent Events) e usa lib/puro.mjs,
// la parte del nucleo che gira anche nel browser, per i numeri e i codici.

import { n0, dec, percento, provaALeggereCodice, formattaCodice, versioneSuccessiva, mesi as Mesi } from '/lib/puro.mjs';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

let stato = null;
let lavoro = null;               // { numero, fatte, totale, finoA, inizio, primoFatte }
                                 // primoFatte è null finché non arriva il primo avanzamento vero del worker:
                                 // il ritmo (e quindi il tempo che manca) si misura da lì, anche quando si riprende un calcolo
let versioneToccata = false;

// ---------------------------------------------------------------------------
// Chiamate al server
// ---------------------------------------------------------------------------
async function chiama(via, corpo = {}, etichetta = null) {
  if (etichetta) scriviComando(etichetta);
  let r;
  try {
    r = await fetch(via, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    avviso('Il server non risponde. È ancora acceso? (avvia.command)');
    return null;
  }
  const dati = await r.json().catch(() => ({}));
  if (!r.ok) {
    avviso(dati.errore || 'Errore ' + r.status);
    if (etichetta) scriviRighe([[{ colore: 'Red', testo: '  ' + (dati.errore || 'Errore ' + r.status) }]]);
    return null;
  }
  if (dati.righe) scriviRighe(dati.righe);
  if (dati.stato) disegna(dati.stato);
  // senza dispositivo il registro è nascosto: se il comando non riesce (per esempio «nasce»), l'errore va nell'avviso
  if (dati.codice && dati.righe && $('cruscotto').hidden)
    avviso(dati.righe.map((r) => r.map((p) => p.testo).join('').trim()).filter(Boolean).join(' '));
  return dati;
}

let timerAvviso = null;
function avviso(testo) {
  const a = $('avviso');
  a.textContent = testo;
  a.hidden = false;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => { a.hidden = true; }, 5000);
}

// ---------------------------------------------------------------------------
// Il registro: lo stesso testo della riga di comando, con i suoi colori
// ---------------------------------------------------------------------------
function scriviComando(testo) {
  const r = $('registro');
  if (r.childElementCount) r.appendChild(Object.assign(document.createElement('div'), { className: 'separatore' }));
  const d = document.createElement('div');
  d.className = 'comando';
  d.textContent = testo;
  r.appendChild(d);
  r.scrollTop = r.scrollHeight;
}

function scriviRighe(righe) {
  const r = $('registro');
  for (const riga of righe) {
    const d = document.createElement('div');
    if (!riga.length) d.innerHTML = '&nbsp;';
    for (const p of riga) {
      const s = document.createElement('span');
      s.className = 'c-' + p.colore;
      s.textContent = p.testo;
      d.appendChild(s);
    }
    r.appendChild(d);
  }
  r.scrollTop = r.scrollHeight;
}

const virgolette = (t) => (/[\s"]/.test(t) || t === '' ? '"' + t + '"' : t);

// ---------------------------------------------------------------------------
// Disegno dello stato
// ---------------------------------------------------------------------------
function disegna(st) {
  stato = st;
  $('cartella').textContent = st.cartella || '—';
  $('nascita').hidden = st.esiste;
  $('cruscotto').hidden = !st.esiste;
  // anche con un dispositivo illeggibile: altrimenti dalla pagina non si esce (nasce rifiuta la cartella)
  $('pulsante-ricomincia').hidden = !st.esiste && !st.errore;
  // un dispositivo che c'è ma non si legge (dispositivo.json rovinato) non è «nessun dispositivo»: lo si dice
  $('nascita-errore').textContent = !st.esiste && st.errore ? st.errore : '';
  $('nascita-errore').hidden = !$('nascita-errore').textContent;
  if (st.lavoro) {
    if (!lavoro || lavoro.numero !== st.lavoro.numero)
      lavoro = { ...st.lavoro, inizio: performance.now(), primoFatte: st.lavoro.totale > 0 ? st.lavoro.fatte : null };
  } else {
    lavoro = null;
  }
  if (!st.esiste) return;

  const d = st.dispositivo;
  document.title = 'Testamento · ' + d.nome;
  $('nome-dispositivo').textContent = '«' + d.nome + '»';
  $('mese-corrente').textContent = 'mese ' + d.mese + ' dalla nascita · ' + d.data;

  const dist = $('distintivo');
  dist.className = 'distintivo';
  if (d.statoTesto === 'LIBERO') { dist.textContent = 'LIBERO'; dist.classList.add('libero'); }
  else if (d.statoTesto === 'LIBERABILE') { dist.textContent = "LIBERABILE: l'ultima capsula è matura"; dist.classList.add('liberabile'); }
  else dist.textContent = 'BLOCCATO, sotto il controllo del produttore';

  $('ind-firmware').innerHTML = '';
  $('ind-firmware').append(d.firmware, piccolo(d.ufficiale ? 'ufficiale' : 'non ufficiale, scelto dal proprietario'));
  const boot = $('ind-bootloader');
  boot.innerHTML = '';
  boot.className = d.liberato ? 'verde' : 'rosso';
  boot.append(d.liberato ? 'SBLOCCATO' : 'BLOCCATO', piccolo(d.liberato ? 'dal mese ' + d.meseLiberazione + ': accetta qualunque firmware' : 'accetta solo firmware firmato'));
  $('ind-aggiornamento').innerHTML = '';
  $('ind-aggiornamento').append(d.ultimoUfficiale + ' al mese ' + d.meseUltimoAggiornamento,
    piccolo(d.mesiSenzaAggiornamenti > 0 ? Mesi(d.mesiSenzaAggiornamenti) + ' fa' : 'questo mese'));
  const prod = $('ind-produttore');
  prod.innerHTML = '';
  prod.className = st.produttore.fallito ? 'rosso' : '';
  prod.append(st.produttore.fallito ? 'Fallito' : 'In attività',
    piccolo(st.produttore.fallito ? 'dal mese ' + st.produttore.meseFallimento + ': niente più aggiornamenti' : 'può ancora rilasciare aggiornamenti'));

  // conto alla rovescia
  const fatti = Math.max(0, Math.min(st.mesiAttesa, d.mese - (d.apreAlMese - st.mesiAttesa)));
  const metro = $('conto-metro');
  metro.setAttribute('aria-valuenow', String(d.liberato ? st.mesiAttesa : fatti));
  metro.classList.toggle('pieno', d.liberato || fatti >= st.mesiAttesa);
  $('conto-riempimento').style.width = (100 * (d.liberato ? 1 : fatti / st.mesiAttesa)) + '%';
  if (d.liberato) {
    $('conto-valore').textContent = 'finito';
    $('conto-nota').textContent = 'Il «' + d.nome + '» è libero dal mese ' + d.meseLiberazione + ': il fusibile della ROM è bruciato.';
  } else if (fatti < st.mesiAttesa) {
    $('conto-valore').textContent = fatti + ' di ' + st.mesiAttesa + ' mesi senza aggiornamenti';
    $('conto-nota').textContent = 'Senza altri aggiornamenti la capsula #' + d.codiceInVigore + ' si aprirà tra ' + Mesi(d.apreAlMese - d.mese) + ' (mese ' + d.apreAlMese + '). Ogni aggiornamento fa ripartire il conto.';
  } else {
    $('conto-valore').textContent = 'finito: ' + Mesi(d.mesiSenzaAggiornamenti) + ' senza aggiornamenti';
    $('conto-nota').textContent = 'La capsula #' + d.codiceInVigore + ' è matura e contiene il codice in vigore: aprila e usa il suo codice.';
  }

  disegnaLinea(st);
  disegnaCapsule(st);

  // il produttore
  if (!versioneToccata || document.activeElement !== $('versione')) {
    $('versione').value = versioneSuccessiva(d.ultimoUfficiale);
    versioneToccata = false;
  }
  $('scheda-certificato').hidden = !st.certificato;
  $('installa-nota').textContent = d.liberato
    ? 'Il bootloader è sbloccato: nessuna firma richiesta.'
    : 'Funziona solo a bootloader sbloccato. Provalo anche prima: vedrai il rifiuto.';

  const t = st.capsule.find((c) => c.T)?.T;
  if (t) $('spiega-t').textContent = n0(t);

  occupato(Boolean(st.lavoro));
}

function piccolo(t) {
  const s = document.createElement('small');
  s.textContent = t;
  return s;
}

function occupato(si) {
  // Mentre il server fa le quadrature, tutto il resto aspetta (tranne «Interrompi»).
  for (const e of document.querySelectorAll('#cruscotto button, #cruscotto input, #cruscotto select')) {
    if (e.dataset.ferma !== undefined) continue;
    e.disabled = si;
  }
  if (!si && stato?.esiste) {
    const d = stato.dispositivo;
    const bloccaAggiorna = d.liberato || stato.produttore.fallito;
    $('pulsante-aggiorna').disabled = bloccaAggiorna;
    $('versione').disabled = bloccaAggiorna;
    $('pulsante-fallisci').disabled = stato.produttore.fallito || d.liberato;
  }
}

// ---------------------------------------------------------------------------
// Le capsule
// ---------------------------------------------------------------------------
function statoCapsula(c, st) {
  if (c.mancante) return { classe: 'mancante', testo: 'capsula mancante!' };
  if (c.aperta) {
    if (c.inVigore && st.dispositivo.liberato) return { classe: 'valida', testo: 'aperta · valida: ha liberato il dispositivo' };
    if (c.inVigore) return { classe: 'valida', testo: 'aperta · VALIDA: può liberare il dispositivo' };
    return { classe: 'scaduta', testo: 'aperta · scaduta (poi è arrivato ' + c.scadutoCon + ')' };
  }
  if (!c.apribile) return { classe: 'sigillata', testo: 'sigillata · mancano ' + Mesi(c.siApre - st.dispositivo.mese) };
  return { classe: c.inVigore ? 'sigillata' : '', testo: 'sigillata · apribile ora (' + (c.inVigore ? 'codice in vigore' : 'codice scaduto') + ')' };
}

function testoAvanzamento(c, fatte, finoA) {
  let t = n0(fatte) + ' di ' + n0(c.T) + ' quadrature · ' + percento(fatte, c.T) + '% · ' + dec(fatte * 18 / c.T, 1) + '/18 mesi';
  if (lavoro && lavoro.numero === c.numero && lavoro.primoFatte != null && fatte > lavoro.primoFatte) {
    const trascorsi = (performance.now() - lavoro.inizio) / 1000;
    const ritmo = (fatte - lavoro.primoFatte) / trascorsi;
    if (ritmo > 0 && finoA > fatte) t += ' · ancora circa ' + dec((finoA - fatte) / ritmo, 0) + ' s';
  }
  if (finoA != null && finoA < c.T && !c.aperta) t += ' · il calendario permette di arrivare al ' + percento(finoA, c.T) + '%';
  return t;
}

function disegnaCapsule(st) {
  const lista = $('capsule');
  // la lista si ridisegna da capo: chi usa la tastiera non deve perdere il punto (per esempio «Apri» → «Interrompi»)
  const fuoco = lista.contains(document.activeElement) ? document.activeElement.closest('li')?.id : null;
  lista.innerHTML = '';
  for (const c of [...st.capsule].reverse()) {
    const li = document.createElement('li');
    const s = statoCapsula(c, st);
    li.className = 'capsula ' + s.classe + (c.inVigore ? ' in-vigore' : '');
    li.id = 'capsula-' + c.numero;
    const inCorso = lavoro && lavoro.numero === c.numero;

    const testa = document.createElement('div');
    testa.className = 'capsula-testa';
    const titolo = document.createElement('h3');
    titolo.className = 'capsula-titolo';
    titolo.textContent = 'Capsula #' + c.numero + ' · ' + c.firmware;
    const chip = document.createElement('span');
    chip.className = 'chip ' + s.classe;
    chip.textContent = inCorso ? 'calcolo in corso…' : s.testo;
    testa.append(titolo, chip);
    li.appendChild(testa);

    const meta = document.createElement('p');
    meta.className = 'capsula-meta';
    meta.textContent = c.mancante ? 'Il file della capsula non c\'è più.'
      : 'Creata al mese ' + c.meseCreazione + ' · si apre al mese ' + c.siApre + ' (' + c.dataApertura + ') · N da ' + c.bitModulo + ' bit · T = ' + n0(c.T)
        + (c.meseScadenza >= 0 ? ' · codice scaduto al mese ' + c.meseScadenza + ' con ' + c.scadutoCon : c.inVigore ? ' · codice in vigore' : '');
    li.appendChild(meta);

    if (!c.mancante) {
      const av = document.createElement('div');
      av.className = 'avanzamento';
      const fatte = inCorso ? lavoro.fatte : c.fatte;
      const finoA = inCorso ? lavoro.finoA : c.consentite;
      const pr = document.createElement('progress');
      pr.max = c.T;
      pr.value = fatte;
      pr.id = 'barra-' + c.numero;
      pr.setAttribute('aria-label', 'Quadrature fatte per la capsula #' + c.numero);
      const testo = document.createElement('span');
      testo.className = 'avanzamento-testo';
      testo.id = 'testo-' + c.numero;
      testo.setAttribute('aria-live', inCorso ? 'polite' : 'off');
      testo.textContent = c.aperta ? 'Aperta al mese ' + c.meseApertura + ' dopo ' + dec(c.secondi, 1) + ' s di calcolo · ' + n0(c.T) + ' quadrature'
        : testoAvanzamento(c, fatte, finoA);
      av.append(pr, testo);
      li.appendChild(av);

      const pulsanti = document.createElement('div');
      pulsanti.className = 'riga-pulsanti';
      if (inCorso) {
        const ferma = bottone('Interrompi il calcolo', () => chiama('/api/ferma'), 'pericolo');
        ferma.dataset.ferma = '';
        pulsanti.appendChild(ferma);
      } else if (!c.aperta) {
        const possibile = c.consentite > c.fatte;
        pulsanti.appendChild(bottone(possibile ? (c.fatte > 0 ? 'Riprendi il calcolo' : 'Apri: fai le quadrature') : 'Apri',
          () => apri(c.numero), c.apribile ? 'primario' : ''));
      }
      if (pulsanti.childElementCount) li.appendChild(pulsanti);

      if (c.codice) {
        const cod = document.createElement('p');
        cod.className = 'codice-uscito';
        const sp = document.createElement('span');
        sp.textContent = c.codice;
        cod.appendChild(sp);
        if (!st.dispositivo.liberato) {
          cod.appendChild(bottone('Prova questo codice', () => {
            $('codice').value = c.codice;
            controllaCodice();
            sblocca();
          }, 'piccolo-pulsante'));
        }
        li.appendChild(cod);
      }
    }
    lista.appendChild(li);
  }
  if (fuoco) document.querySelector('#' + fuoco + ' button')?.focus();
}

function bottone(testo, azione, classe = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pulsante ' + classe;
  b.textContent = testo;
  b.addEventListener('click', azione);
  return b;
}

async function apri(numero) {
  scriviComando('testamento apri ' + numero);
  const r = await chiama('/api/apri', { numero });
  if (r && (!lavoro || lavoro.numero !== numero)) lavoro = { numero, fatte: 0, totale: 0, finoA: 0, inizio: performance.now(), primoFatte: null };
}

function aggiornaProgresso(m) {
  if (!lavoro || lavoro.numero !== m.numero) lavoro = { numero: m.numero, inizio: performance.now(), primoFatte: m.fatte };
  else if (lavoro.primoFatte == null) Object.assign(lavoro, { inizio: performance.now(), primoFatte: m.fatte });
  Object.assign(lavoro, { fatte: m.fatte, totale: m.totale, finoA: m.finoA });
  const pr = $('barra-' + m.numero);
  const testo = $('testo-' + m.numero);
  const c = stato?.capsule.find((x) => x.numero === m.numero);
  if (!pr || !c) { if (stato) disegna({ ...stato, lavoro: { ...lavoro } }); return; }
  pr.value = m.fatte;
  testo.textContent = testoAvanzamento(c, m.fatte, m.finoA);
  const seg = document.querySelector('#linea .calcolo-' + m.numero);
  if (seg) seg.setAttribute('width', String(Number(seg.dataset.larghezza) * m.fatte / c.T));
}

// ---------------------------------------------------------------------------
// La linea del tempo (SVG)
// ---------------------------------------------------------------------------
function el(nome, attributi = {}, testo) {
  const e = document.createElementNS(SVG, nome);
  for (const [k, v] of Object.entries(attributi)) e.setAttribute(k, String(v));
  if (testo != null) e.textContent = testo;
  return e;
}

function disegnaLinea(st) {
  const svg = $('linea');
  svg.innerHTML = '';
  const d = st.dispositivo;
  const ultimaApertura = Math.max(...st.capsule.map((c) => c.siApre));
  const fine = Math.max(24, d.mese + 4, ultimaApertura + 2, d.liberato ? d.meseLiberazione + 3 : 0);
  const W = 900;
  const L = 86;
  const R = 22;
  const alto = 46;                // spazio sopra le etichette del firmware per «il produttore fallisce»
  const riga = 30;
  const H = alto + 34 + st.capsule.length * riga + 36;
  const x = (m) => L + (m * (W - L - R)) / fine;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const yAsse = H - 26;

  // griglia ogni 6 mesi
  const passo = fine > 60 ? 12 : 6;
  for (let m = 0; m <= fine; m += passo) {
    svg.appendChild(el('line', { x1: x(m), x2: x(m), y1: 14, y2: yAsse, class: 'griglia' }));
    svg.appendChild(el('text', { x: x(m), y: yAsse + 16, 'text-anchor': 'middle' }, String(m)));
  }
  svg.appendChild(el('line', { x1: L, x2: W - R, y1: yAsse, y2: yAsse, class: 'asse' }));
  svg.appendChild(el('text', { x: 8, y: yAsse + 16 }, 'mesi'));

  // corsia del firmware
  const yF = alto;
  svg.appendChild(el('text', { x: 8, y: yF + 4, class: 'etichetta-forte' }, 'Firmware'));
  svg.appendChild(el('line', { x1: x(0), x2: x(d.mese), y1: yF, y2: yF, class: 'asse' }));
  st.storia.forEach((v, i) => {
    const cx = x(v.mese);
    if (v.ufficiale) {
      svg.appendChild(el('rect', { x: cx - 5, y: yF - 5, width: 10, height: 10, transform: `rotate(45 ${cx} ${yF})`, class: 'aggiornamento' }));
    } else {
      svg.appendChild(el('circle', { cx, cy: yF, r: 6, class: 'libero-segno' }));
    }
    svg.appendChild(el('text', { x: cx, y: yF + (i % 2 ? 18 : -10), 'text-anchor': 'middle', class: v.ufficiale ? '' : 'testo-libero' }, v.firmware));
  });

  // le capsule
  st.capsule.forEach((c, i) => {
    const y = alto + 34 + i * riga;
    svg.appendChild(el('text', { x: 8, y: y + 4, class: 'etichetta-forte' }, 'Capsula #' + c.numero));
    if (c.mancante) return;
    const x0 = x(c.meseCreazione);
    const x1 = x(c.siApre);
    svg.appendChild(el('rect', { x: x0, y: y - 7, width: x1 - x0, height: 14, rx: 4, class: 'sigillo' }));
    const fatte = lavoro && lavoro.numero === c.numero ? lavoro.fatte : c.fatte;
    const seg = el('rect', { x: x0, y: y - 7, width: (x1 - x0) * fatte / c.T, height: 14, rx: 4, class: 'calcolo calcolo-' + c.numero });
    seg.dataset.larghezza = String(x1 - x0);
    svg.appendChild(seg);
    if (c.meseScadenza >= 0) {
      const xs = x(c.meseScadenza);
      svg.appendChild(el('line', { x1: xs, x2: xs, y1: y - 10, y2: y + 10, stroke: 'var(--ambra)', 'stroke-width': 2 }));
    }
    let classe;
    if (c.meseScadenza >= 0 && c.meseScadenza <= c.siApre) classe = 'apre-scaduta';
    else if (c.meseScadenza >= 0) classe = 'apre-scaduta';
    else if (d.mese >= c.siApre) classe = 'apre-valida';
    else classe = 'apre-futura';
    const cerchio = el('circle', { cx: x1, cy: y, r: 6, class: classe });
    cerchio.appendChild(el('title', {}, 'La capsula #' + c.numero + ' si apre al mese ' + c.siApre
      + (c.meseScadenza >= 0 ? ': il suo codice è scaduto al mese ' + c.meseScadenza : ': contiene il codice in vigore')));
    svg.appendChild(cerchio);
  });

  // fallimento, liberazione, oggi
  if (st.produttore.fallito) {
    const xf = x(st.produttore.meseFallimento);
    svg.appendChild(el('line', { x1: xf, x2: xf, y1: 10, y2: yAsse, class: 'fallimento' }));
    // vicino al bordo destro la scritta va a sinistra della linea, altrimenti esce dal disegno
    const aSinistra = xf > W - 130;
    svg.appendChild(el('text', { x: aSinistra ? xf - 4 : xf + 4, y: 12, 'text-anchor': aSinistra ? 'end' : 'start', class: 'testo-fallimento' }, 'il produttore fallisce'));
  }
  const xo = x(d.mese);
  svg.appendChild(el('line', { x1: xo, x2: xo, y1: 16, y2: yAsse, class: 'oggi' }));
  svg.appendChild(el('text', { x: Math.min(xo + 4, W - 60), y: yAsse - 4, class: 'etichetta-forte' }, 'oggi'));

  const parti = ['Mese ' + d.mese + '.'];
  for (const v of st.storia) parti.push((v.ufficiale ? 'Aggiornamento ' : 'Firmware libero ') + v.firmware + ' al mese ' + v.mese + '.');
  for (const c of st.capsule) parti.push('Capsula #' + c.numero + ': creata al mese ' + c.meseCreazione + ', si apre al mese ' + c.siApre
    + (c.meseScadenza >= 0 ? ', codice scaduto al mese ' + c.meseScadenza : ', codice in vigore') + '.');
  if (st.produttore.fallito) parti.push('Il produttore fallisce al mese ' + st.produttore.meseFallimento + '.');
  if (d.liberato) parti.push('Libero dal mese ' + d.meseLiberazione + '.');
  $('linea-descrizione').textContent = parti.join(' ');
}

// ---------------------------------------------------------------------------
// I moduli
// ---------------------------------------------------------------------------
function controllaCodice() {
  const v = $('codice').value.trim();
  const aiuto = $('codice-aiuto');
  aiuto.className = 'aiuto';
  $('codice').removeAttribute('aria-invalid');
  if (!v) { aiuto.textContent = 'Trattini, spazi e minuscole vanno bene.'; return; }
  const b = provaALeggereCodice(v);
  if (b) {
    aiuto.textContent = 'Formato giusto: ' + formattaCodice(b);
    aiuto.classList.add('ok');
  } else {
    const cifre = v.replace(/[-\s_.]/g, '');
    aiuto.textContent = /^[0-9a-fA-F]*$/.test(cifre) ? cifre.length + ' cifre su 32' : 'Solo cifre esadecimali (0-9, A-F)';
    aiuto.classList.add('errore');
    $('codice').setAttribute('aria-invalid', 'true');
  }
}

async function sblocca() {
  const v = $('codice').value.trim();
  if (!v) { $('codice').focus(); return; }
  await chiama('/api/sblocca', { codice: v }, 'testamento sblocca ' + v);
}

function collega() {
  $('modulo-nascita').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = $('nome').value.trim() || 'Caldo 3000';
    const bit = $('bit').value;
    const pulsante = e.submitter;
    if (pulsante) { pulsante.disabled = true; pulsante.textContent = 'Nasce… (genero i primi)'; }
    await chiama('/api/nasce', { nome, bit }, 'testamento nasce ' + virgolette(nome) + (bit !== '1024' ? ' --bit ' + bit : ''));
    if (pulsante) { pulsante.disabled = false; pulsante.textContent = 'Fai nascere'; }
  });
  for (const b of document.querySelectorAll('[data-mesi]')) {
    b.addEventListener('click', () => chiama('/api/tempo', { mesi: b.dataset.mesi }, 'testamento tempo ' + b.dataset.mesi));
  }
  $('modulo-tempo').addEventListener('submit', (e) => {
    e.preventDefault();
    chiama('/api/tempo', { mesi: $('mesi').value }, 'testamento tempo ' + $('mesi').value);
  });
  $('versione').addEventListener('input', () => { versioneToccata = true; });
  $('modulo-aggiorna').addEventListener('submit', (e) => {
    e.preventDefault();
    versioneToccata = false;
    chiama('/api/aggiorna', { versione: $('versione').value }, 'testamento aggiorna ' + $('versione').value);
  });
  $('pulsante-fallisci').addEventListener('click', () => {
    if (confirm('Il produttore fallisce: da oggi non arriverà più nessun aggiornamento. Continuare?'))
      chiama('/api/fallisci', {}, '(il produttore fallisce)');
  });
  $('codice').addEventListener('input', controllaCodice);
  $('modulo-sblocca').addEventListener('submit', (e) => { e.preventDefault(); sblocca(); });
  $('pulsante-indovina').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    await chiama('/api/indovina', { secondi: 2 }, 'testamento indovina 2');
    b.disabled = false;
  });
  $('modulo-installa').addEventListener('submit', (e) => {
    e.preventDefault();
    chiama('/api/installa', { firmware: $('firmware').value }, 'testamento installa ' + virgolette($('firmware').value));
  });
  $('pulisci-registro').addEventListener('click', () => { $('registro').innerHTML = ''; });
  $('pulsante-ricomincia').addEventListener('click', () => {
    if (confirm('Cancellare questo dispositivo e farne nascere uno nuovo?')) chiama('/api/ricomincia', {}, '(nuovo dispositivo)');
  });
}

// ---------------------------------------------------------------------------
// Server-Sent Events: stato, avanzamento delle quadrature, fine del calcolo
// ---------------------------------------------------------------------------
function ascolta() {
  const conn = $('connessione');
  const es = new EventSource('/api/eventi');
  es.addEventListener('open', () => { conn.textContent = 'Collegato al Mac'; conn.classList.add('attiva'); });
  es.addEventListener('error', () => { conn.textContent = 'Server non raggiungibile: riprovo…'; conn.classList.remove('attiva'); });
  es.addEventListener('stato', (e) => disegna(JSON.parse(e.data)));
  es.addEventListener('progresso', (e) => aggiornaProgresso(JSON.parse(e.data)));
  es.addEventListener('fine', (e) => {
    const m = JSON.parse(e.data);
    lavoro = null;
    scriviRighe(m.righe);
    if (m.codice === 3) avviso('CAPSULA MANOMESSA: il contenuto non viene mostrato.');
  });
}

collega();
ascolta();
