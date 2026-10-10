// TESTAMENTO - lo stato del dispositivo per l'interfaccia web, in un unico oggetto JSON.
// Usa le stesse regole dei comandi "stato" e "tempo".

import fs from 'node:fs';
import { Rom } from './dispositivo.mjs';
import { Data, UltimaUfficiale } from './comandi.mjs';
import { percento } from './puro.mjs';

export function statoCruscotto(arc) {
  if (!arc.esiste()) return { esiste: false, cartella: arc.Radice, mesiAttesa: Rom.MESI_ATTESA };
  const s = arc.leggiStato();
  const iv = Rom.inVigore(s);
  const apre = iv ? iv.MeseCreazione + Rom.MESI_ATTESA : 0;
  const uff = UltimaUfficiale(s);
  const senza = s.Mese - s.MeseUltimoAggiornamento;
  const prod = arc.leggiCruscotto();
  const tent = arc.leggiTentativi();

  let statoTesto;
  if (s.Rom.Liberato) statoTesto = 'LIBERO';
  else if (s.Mese >= apre) statoTesto = 'LIBERABILE';
  else statoTesto = 'BLOCCATO';

  const capsule = s.Rom.Codici.map((imp) => {
    const c = arc.leggiCapsula(imp.Numero);
    const w = arc.leggiLavoro(imp.Numero);
    const siApre = imp.MeseCreazione + Rom.MESI_ATTESA;
    const inVigore = imp.Numero === s.Rom.CodiceInVigore && imp.MeseScadenza < 0;
    if (c == null) return { numero: imp.Numero, firmware: imp.Firmware, meseCreazione: imp.MeseCreazione, siApre, mancante: true };
    const trascorsi = s.Mese - c.MeseCreazione;
    const consentite = trascorsi >= c.MesiAttesa ? c.T : Math.floor(c.T * Math.max(0, trascorsi) / c.MesiAttesa);
    const fatte = w && w.Fatte >= 0 && w.Fatte <= c.T ? w.Fatte : 0;
    const aperta = fatte >= c.T;
    return {
      numero: imp.Numero,
      firmware: imp.Firmware,
      meseCreazione: imp.MeseCreazione,
      siApre,
      dataApertura: Data(s, siApre),
      T: c.T,
      bitModulo: c.BitModulo,
      fatte,
      consentite,
      percento: percento(fatte, c.T),
      aperta,
      apribile: s.Mese >= siApre,
      inVigore,
      meseScadenza: imp.MeseScadenza,
      scadutoCon: imp.ScadutoCon,
      meseApertura: w ? w.MeseApertura : -1,
      secondi: w ? w.Secondi : 0,
      codice: aperta ? arc.leggiCodicePubblicato(imp.Numero) : null,
      impronta: imp.Impronta,
    };
  });

  return {
    esiste: true,
    cartella: arc.Radice,
    mesiAttesa: Rom.MESI_ATTESA,
    dispositivo: {
      nome: s.Nome,
      mese: s.Mese,
      data: Data(s, s.Mese),
      nascita: Data(s, 0),
      firmware: s.Firmware,
      ufficiale: s.FirmwareUfficiale,
      bootloader: s.Bootloader,
      liberato: s.Rom.Liberato,
      meseLiberazione: s.MeseLiberazione,
      meseUltimoAggiornamento: s.MeseUltimoAggiornamento,
      ultimoUfficiale: uff.Firmware,
      mesiSenzaAggiornamenti: senza,
      quadratureAlMese: s.QuadratureAlMese,
      quadratureAlSecondo: s.QuadratureAlSecondo,
      codiceInVigore: s.Rom.CodiceInVigore,
      apreAlMese: apre,
      statoTesto,
    },
    storia: s.Storia.map((v) => ({ mese: v.Mese, firmware: v.Firmware, ufficiale: v.Ufficiale, data: Data(s, v.Mese) })),
    capsule,
    produttore: { fallito: prod.ProduttoreFallito, meseFallimento: prod.MeseFallimento },
    tentativi: { falsiDiFila: tent.CodiciFalsiDiFila, prossimo: tent.ProssimoTentativo },
    certificato: fs.existsSync(arc.FileCertificato),
  };
}
