// TESTAMENTO - il dispositivo simulato: stato, ROM di avvio, archivio su disco.

using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace Testamento
{
    // -------------------------------------------------------------------------
    // Stato del dispositivo (dispositivo.json)
    // -------------------------------------------------------------------------
    public class StatoDispositivo
    {
        public string Formato { get; set; }
        public string Nome { get; set; }
        public int AnnoNascita { get; set; }
        public int MeseNascita { get; set; }
        public int Mese { get; set; }                       // calendario simulato: mesi dalla nascita
        public string Firmware { get; set; }
        public bool FirmwareUfficiale { get; set; }
        public int MeseUltimoAggiornamento { get; set; }
        public string Bootloader { get; set; }              // BLOCCATO | SBLOCCATO
        public int MeseLiberazione { get; set; }            // -1 finché non è libero
        public long QuadratureAlMese { get; set; }          // dalla taratura: quanto "pesa" un mese simulato
        public double QuadratureAlSecondo { get; set; }
        public RegistroRom Rom { get; set; }
        public List<VoceStoria> Storia { get; set; }
    }

    // La parte di stato che solo la ROM può scrivere. In un chip vero starebbe
    // in una memoria OTP o dietro un fusibile, fuori dalla portata del firmware.
    public class RegistroRom
    {
        public int CodiceInVigore { get; set; }             // numero della capsula il cui codice vale oggi
        public bool Liberato { get; set; }                  // il "fusibile": una volta bruciato, resta così
        public List<ImprontaCodice> Codici { get; set; }
    }

    public class ImprontaCodice
    {
        public int Numero { get; set; }
        public string Firmware { get; set; }                // versione per cui è stato generato
        public int MeseCreazione { get; set; }
        public string Sale { get; set; }
        public string Impronta { get; set; }                // SHA-256(sale || codice): il codice NON è qui
        public int MeseScadenza { get; set; }               // -1 se è ancora in vigore
        public string ScadutoCon { get; set; }              // la versione che l'ha fatto scadere
    }

    public class VoceStoria
    {
        public int Mese { get; set; }
        public string Firmware { get; set; }
        public bool Ufficiale { get; set; }
    }

    // Il calcolo fatto finora per aprire una capsula (capsula-N.lavoro.json).
    // Il puzzle RSW si può interrompere e riprendere: basta ricordare x e quante quadrature mancano.
    public class LavoroCapsula
    {
        public int Numero { get; set; }
        public long Fatte { get; set; }
        public string X { get; set; }
        public double Secondi { get; set; }
        public int MeseApertura { get; set; }               // -1 finché non è aperta
    }

    public class Taratura
    {
        public double QuadratureAlSecondo { get; set; }
        public int BitModulo { get; set; }
        public string Misurata { get; set; }
    }

    // -------------------------------------------------------------------------
    // La ROM di avvio
    // -------------------------------------------------------------------------
    // Scritta in fabbrica e immutabile: nessun aggiornamento può cambiarne il
    // comportamento. Il firmware del produttore non vede mai i codici: la ROM
    // li genera, ne conserva solo l'impronta salata e li chiude in una capsula.
    public static class Rom
    {
        public const int MESI_ATTESA = 18;
        public const int BIT_PRIMI = 512;          // N da 1024 bit

        public enum Esito { Valido, Scaduto, Falso }

        public class Sigillatura
        {
            public Capsula Capsula;
            public ImprontaCodice Impronta;
            public ImprontaCodice Scaduto;         // il codice che ha smesso di valere (null alla nascita)
            public double Secondi;
        }

        // Chiamata alla nascita e a ogni cambio di firmware ufficiale.
        public static Sigillatura NuovoTestamento(StatoDispositivo s, string firmware, RandomNumberGenerator rng)
        {
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            Sigillatura r = new Sigillatura();
            int numero = s.Rom.Codici.Count + 1;

            byte[] codice = Codice.Nuovo(rng);                      // il generatore casuale del chip
            byte[] sale = new byte[16];
            rng.GetBytes(sale);

            long t = MESI_ATTESA * s.QuadratureAlMese;
            PuzzleRsw z = PuzzleRsw.Nuovo(rng, BIT_PRIMI, t);
            r.Capsula = Capsula.Sigilla(z, codice, numero, s.Nome, firmware, s.Mese, MESI_ATTESA);
            z.Dimentica();                                          // p, q e φ(N) spariscono

            ImprontaCodice imp = new ImprontaCodice();
            imp.Numero = numero;
            imp.Firmware = firmware;
            imp.MeseCreazione = s.Mese;
            imp.Sale = Hex.DaByte(sale);
            imp.Impronta = Hex.DaByte(Codice.Impronta(sale, codice));
            imp.MeseScadenza = -1;
            Array.Clear(codice, 0, codice.Length);                  // e anche il codice

            foreach (ImprontaCodice v in s.Rom.Codici)
            {
                if (v.MeseScadenza < 0)
                {
                    v.MeseScadenza = s.Mese;
                    v.ScadutoCon = firmware;
                    r.Scaduto = v;
                }
            }
            s.Rom.Codici.Add(imp);
            s.Rom.CodiceInVigore = numero;
            r.Impronta = imp;
            r.Secondi = sw.Elapsed.TotalSeconds;
            return r;
        }

        // Confronta il codice con tutte le impronte. Solo quella in vigore sblocca;
        // le altre servono a spiegare perché un codice vecchio non vale più.
        public static Esito Verifica(StatoDispositivo s, byte[] codice, out ImprontaCodice trovato)
        {
            trovato = null;
            foreach (ImprontaCodice v in s.Rom.Codici)
            {
                byte[] calcolata = Codice.Impronta(Hex.AByte(v.Sale), codice);
                if (Codice.Uguali(calcolata, Hex.AByte(v.Impronta))) trovato = v;
            }
            if (trovato == null) return Esito.Falso;
            if (trovato.Numero == s.Rom.CodiceInVigore && trovato.MeseScadenza < 0) return Esito.Valido;
            return Esito.Scaduto;
        }

        public static ImprontaCodice InVigore(StatoDispositivo s)
        {
            foreach (ImprontaCodice v in s.Rom.Codici)
                if (v.Numero == s.Rom.CodiceInVigore) return v;
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // La cartella del dispositivo
    // -------------------------------------------------------------------------
    //   dispositivo.json               stato, compreso il registro della ROM (solo impronte)
    //   capsule\capsula-N.json         la capsula pubblica: N, a, T, codice cifrato
    //   capsule\capsula-N.lavoro.json  quante quadrature sono state fatte finora
    //   capsule\capsula-N.codice.txt   il codice, dopo che qualcuno ha aperto la capsula
    //   certificato-di-liberazione.txt
    public class Archivio
    {
        public const string FORMATO = "testamento-dispositivo-1";

        public readonly string Radice;
        public readonly string FileStato;
        public readonly string CartellaCapsule;
        public readonly string FileCertificato;

        public Archivio(string radice)
        {
            Radice = Path.GetFullPath(radice);
            FileStato = Path.Combine(Radice, "dispositivo.json");
            CartellaCapsule = Path.Combine(Radice, "capsule");
            FileCertificato = Path.Combine(Radice, "certificato-di-liberazione.txt");
        }

        public bool Esiste() { return File.Exists(FileStato); }

        public string FileCapsula(int n) { return Path.Combine(CartellaCapsule, "capsula-" + n + ".json"); }
        public string FileLavoro(int n) { return Path.Combine(CartellaCapsule, "capsula-" + n + ".lavoro.json"); }
        public string FileCodice(int n) { return Path.Combine(CartellaCapsule, "capsula-" + n + ".codice.txt"); }

        public StatoDispositivo LeggiStato()
        {
            if (!Esiste())
                throw new ErroreUtente("Nessun dispositivo in '" + Radice + "'. Fallo nascere con:  testamento nasce \"<nome>\"");
            StatoDispositivo s = Json.Leggi<StatoDispositivo>(FileStato);
            if (s == null || s.Formato != FORMATO || s.Rom == null || s.Rom.Codici == null)
                throw new ErroreUtente("'" + FileStato + "' non è uno stato di Testamento valido.");
            if (s.Storia == null) s.Storia = new List<VoceStoria>();
            return s;
        }

        public void SalvaStato(StatoDispositivo s) { Directory.CreateDirectory(Radice); Json.Scrivi(FileStato, s); }

        public void SalvaCapsula(Capsula c) { Directory.CreateDirectory(CartellaCapsule); Json.Scrivi(FileCapsula(c.Numero), c); }

        public Capsula LeggiCapsula(int n)
        {
            string f = FileCapsula(n);
            if (!File.Exists(f)) return null;
            return Json.Leggi<Capsula>(f);
        }

        public LavoroCapsula LeggiLavoro(int n)
        {
            string f = FileLavoro(n);
            if (!File.Exists(f)) return null;
            return Json.Leggi<LavoroCapsula>(f);
        }

        public void SalvaLavoro(LavoroCapsula w) { Directory.CreateDirectory(CartellaCapsule); Json.Scrivi(FileLavoro(w.Numero), w); }
    }

    public class ErroreUtente : Exception
    {
        public ErroreUtente(string messaggio) : base(messaggio) { }
    }

    // -------------------------------------------------------------------------
    // JSON leggibile (JavaScriptSerializer + indentazione)
    // -------------------------------------------------------------------------
    public static class Json
    {
        public static T Leggi<T>(string percorso)
        {
            string testo = File.ReadAllText(percorso, Encoding.UTF8);
            JavaScriptSerializer js = new JavaScriptSerializer();
            js.MaxJsonLength = 16 * 1024 * 1024;
            try { return js.Deserialize<T>(testo); }
            catch (Exception e) { throw new ErroreUtente("File JSON illeggibile: '" + percorso + "' (" + e.Message + ")"); }
        }

        public static void Scrivi(string percorso, object o)
        {
            JavaScriptSerializer js = new JavaScriptSerializer();
            js.MaxJsonLength = 16 * 1024 * 1024;
            ScriviTesto(percorso, Indenta(js.Serialize(o)) + Environment.NewLine, false);
        }

        // Scrittura atomica: prima un file temporaneo, poi lo scambio.
        public static void ScriviTesto(string percorso, string testo, bool bom)
        {
            string tmp = percorso + ".tmp";
            File.WriteAllText(tmp, testo, new UTF8Encoding(bom));
            if (File.Exists(percorso)) File.Replace(tmp, percorso, null);
            else File.Move(tmp, percorso);
        }

        public static string Indenta(string json)
        {
            StringBuilder sb = new StringBuilder();
            int livello = 0;
            bool inStringa = false;
            for (int i = 0; i < json.Length; i++)
            {
                char c = json[i];
                if (inStringa)
                {
                    sb.Append(c);
                    if (c == '\\' && i + 1 < json.Length) { i++; sb.Append(json[i]); }
                    else if (c == '"') inStringa = false;
                    continue;
                }
                switch (c)
                {
                    case '"':
                        inStringa = true;
                        sb.Append(c);
                        break;
                    case '{':
                    case '[':
                        if (i + 1 < json.Length && (json[i + 1] == '}' || json[i + 1] == ']'))
                        {
                            sb.Append(c).Append(json[i + 1]);
                            i++;
                            break;
                        }
                        livello++;
                        sb.Append(c).AppendLine().Append(' ', livello * 2);
                        break;
                    case '}':
                    case ']':
                        livello--;
                        sb.AppendLine().Append(' ', livello * 2).Append(c);
                        break;
                    case ',':
                        sb.Append(c).AppendLine().Append(' ', livello * 2);
                        break;
                    case ':':
                        sb.Append(": ");
                        break;
                    default:
                        sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }
    }
}
