// TESTAMENTO - dove finisce il testo dei comandi.
//
// I comandi scrivono righe colorate con i colori della console di Windows
// (Gray, DarkGray, White, Green, Yellow, Red, Cyan, Magenta, DarkYellow, DarkCyan).
//   UscitaTerminale  li traduce in colori ANSI (solo se l'uscita è un terminale e NO_COLOR non c'è);
//                    rediretta su file o pipe, il testo resta identico e senza colori, come l'originale.
//   UscitaRaccolta   li conserva in memoria: la usano il server web e i test.

const ANSI = {
  Gray: '',
  White: '\x1b[1;97m',
  DarkGray: '\x1b[90m',
  Green: '\x1b[92m',
  Yellow: '\x1b[93m',
  Red: '\x1b[91m',
  Cyan: '\x1b[96m',
  Magenta: '\x1b[95m',
  DarkYellow: '\x1b[33m',
  DarkCyan: '\x1b[36m',
};

export class UscitaTerminale {
  constructor(flusso = process.stdout, env = process.env) {
    this.flusso = flusso;
    this.dalVivo = Boolean(flusso.isTTY);
    this.colori = this.dalVivo && !env.NO_COLOR && env.TERM !== 'dumb';
  }

  riga(a, b) {
    if (a === undefined) return this.scrivi('\n');
    if (b === undefined) return this.scrivi(a + '\n');
    this.pezzo(a, b);
    this.scrivi('\n');
  }

  pezzo(colore, testo) {
    const c = this.colori ? ANSI[colore] || '' : '';
    this.scrivi(c ? c + testo + '\x1b[0m' : testo);
  }

  scrivi(testo) {
    this.flusso.write(testo);
  }
}

// Conserva le righe come elenchi di pezzi { colore, testo }.
export class UscitaRaccolta {
  constructor() {
    this.dalVivo = false;
    this.righe = [[]];
  }

  riga(a, b) {
    if (a !== undefined && b === undefined) this.pezzo('Gray', a);
    else if (a !== undefined) this.pezzo(a, b);
    this.righe.push([]);
  }

  pezzo(colore, testo) {
    // un "\n" dentro il testo (succede in installa) va a capo anche qui
    const parti = String(testo).split('\n');
    parti.forEach((p, i) => {
      if (i > 0) this.righe.push([]);
      if (p.length) this.righe[this.righe.length - 1].push({ colore, testo: p });
    });
  }

  scrivi(testo) {
    if (testo === '\r') { this.righe[this.righe.length - 1] = []; return; }
    if (testo === '\n') { this.righe.push([]); return; }
    this.pezzo('Gray', testo);
  }

  // Le righe complete (l'ultima, vuota, è quella in cui si scriverebbe dopo).
  elenco() {
    const r = this.righe.slice();
    if (r.length && r[r.length - 1].length === 0) r.pop();
    return r;
  }

  testo() {
    return this.elenco().map((riga) => riga.map((p) => p.testo).join('')).join('\n') + '\n';
  }
}
