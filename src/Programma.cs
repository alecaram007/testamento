// TESTAMENTO - l'hardware che si libera da solo quando il produttore lo abbandona.
//
// Riga di comando del simulatore:   testamento <comando> [argomenti] [--dispositivo <cartella>]
// (testamento aiuto per l'elenco dei comandi)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Testamento
{
    public static class Programma
    {
        // Nel simulatore un mese di calendario "pesa" 0,6 secondi di calcolo su questo PC:
        // una capsula da 18 mesi si apre in circa 11 secondi.
        public const double SECONDI_PER_MESE = 0.6;

        public const int OK = 0;
        public const int ERRORE = 1;
        public const int RIFIUTATO = 2;     // codice scaduto o falso, installazione negata, capsula ancora sigillata
        public const int MANOMESSA = 3;     // l'HMAC della capsula non torna

        const string BLOCCATO = "BLOCCATO";
        const string SBLOCCATO = "SBLOCCATO";

        static readonly CultureInfo IT = CultureInfo.GetCultureInfo("it-IT");
        static readonly CultureInfo INV = CultureInfo.InvariantCulture;

        public static int Main(string[] args)
        {
            try { Console.OutputEncoding = new UTF8Encoding(false); } catch { }
            try
            {
                return Esegui(args);
            }
            catch (ErroreUtente e)
            {
                Riga();
                Riga(ConsoleColor.Red, "  Errore: " + e.Message);
                return ERRORE;
            }
            catch (Exception e)
            {
                Riga();
                Riga(ConsoleColor.Red, "  Errore imprevisto (" + e.GetType().Name + "): " + e.Message);
                return ERRORE;
            }
        }

        static int Esegui(string[] args)
        {
            List<string> pos = new List<string>();
            string cartella = null;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                string al = a.ToLowerInvariant();
                if (al == "-dispositivo" || al == "--dispositivo" || al == "-d")
                {
                    if (i + 1 >= args.Length) throw new ErroreUtente("Manca la cartella dopo " + a + ".");
                    cartella = args[++i];
                }
                else if (al.StartsWith("--dispositivo=") || al.StartsWith("-dispositivo="))
                    cartella = a.Substring(a.IndexOf('=') + 1);
                else
                    pos.Add(a);
            }
            if (pos.Count == 0) { Aiuto(); return OK; }
            if (string.IsNullOrEmpty(cartella)) cartella = Environment.GetEnvironmentVariable("TESTAMENTO_DISPOSITIVO");
            if (string.IsNullOrEmpty(cartella)) cartella = "dispositivo";

            Archivio arc = new Archivio(cartella);
            string resto = string.Join(" ", pos.GetRange(1, pos.Count - 1).ToArray()).Trim();
            switch (pos[0].ToLowerInvariant())
            {
                case "aiuto":
                case "help":
                case "-h":
                case "--help":
                case "-?":
                case "/?":
                    Aiuto();
                    return OK;
                case "nasce": return Nasce(arc, resto);
                case "aggiorna": return Aggiorna(arc, resto);
                case "tempo": return Tempo(arc, resto);
                case "stato": return Stato(arc);
                case "apri": return Apri(arc, resto);
                case "sblocca": return Sblocca(arc, resto);
                case "installa": return Installa(arc, resto);
                case "indovina": return Indovina(arc, resto);
                case "taratura": return RifaiTaratura();
                default:
                    throw new ErroreUtente("Comando sconosciuto: '" + pos[0] + "'. Scrivi:  testamento aiuto");
            }
        }

        // =====================================================================
        // nasce
        // =====================================================================
        static int Nasce(Archivio arc, string nome)
        {
            if (nome.Length == 0) throw new ErroreUtente("Serve un nome:  testamento nasce \"Caldo 3000\"");
            if (arc.Esiste())
            {
                StatoDispositivo c = arc.LeggiStato();
                throw new ErroreUtente("In '" + arc.Radice + "' esiste già un dispositivo («" + c.Nome + "»). Scegli un'altra cartella con --dispositivo <cartella>.");
            }

            StatoDispositivo s = new StatoDispositivo();
            s.Formato = Archivio.FORMATO;
            s.Nome = nome;
            s.AnnoNascita = DateTime.Today.Year;
            s.MeseNascita = DateTime.Today.Month;
            s.Mese = 0;
            s.Firmware = "v1.0";
            s.FirmwareUfficiale = true;
            s.MeseUltimoAggiornamento = 0;
            s.Bootloader = BLOCCATO;
            s.MeseLiberazione = -1;
            s.Rom = new RegistroRom();
            s.Rom.Codici = new List<ImprontaCodice>();
            s.Storia = new List<VoceStoria>();
            AggiungiStoria(s, "v1.0", true);

            Riga();
            Riga(ConsoleColor.White, "  TESTAMENTO · nasce «" + nome + "» · " + Data(s, 0));
            Riga(ConsoleColor.DarkGray, "  cartella del dispositivo: " + arc.Radice);

            double qps;
            string origine;
            long qpm = QuadratureAlMese(out qps, out origine);
            s.QuadratureAlMese = qpm;
            s.QuadratureAlSecondo = qps;

            Riga();
            if (qps > 0)
            {
                Riga("  Taratura: questo PC fa " + N0(qps) + " quadrature al secondo modulo N da 1024 bit");
                Riga(ConsoleColor.DarkGray, "  (" + origine + ").");
                Riga(ConsoleColor.DarkGray, "  Nel simulatore 1 mese = " + N0(qpm) + " quadrature ≈ " + Dec(qpm / qps, 1) + " s di calcolo.");
            }
            else
                Riga(ConsoleColor.DarkGray, "  Taratura " + origine + ": 1 mese = " + N0(qpm) + " quadrature (modalità di prova).");
            Riga();
            Riga("  Il produttore installa il firmware v1.0.");
            Riga("  Bootloader: BLOCCATO (accetta solo firmware firmato dal produttore).");
            Riga();
            Riga("  La ROM di avvio genera il codice di liberazione #1: 128 bit dal generatore casuale del chip.");

            Rom.Sigillatura r;
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
                r = Rom.NuovoTestamento(s, "v1.0", rng);
            arc.SalvaCapsula(r.Capsula);
            arc.SalvaStato(s);
            MostraSigillatura(arc, s, r);

            Riga();
            Riga(ConsoleColor.Green, "  Il codice non lo conosce nessuno: né il produttore, né il dispositivo.");
            Riga("  Finché arrivano aggiornamenti, ogni capsula che si apre contiene un codice già scaduto.");
            Riga("  Se gli aggiornamenti si fermano, l'ultima capsula si apre e libera il «" + nome + "».");
            return OK;
        }

        static void MostraSigillatura(Archivio arc, StatoDispositivo s, Rom.Sigillatura r)
        {
            Capsula c = r.Capsula;
            int apre = c.MeseCreazione + c.MesiAttesa;
            Riga("    nella ROM resta solo l'impronta  SHA-256(sale || codice) = " + Abbrevia(r.Impronta.Impronta));
            Riga(ConsoleColor.DarkGray, "    il codice stesso non viene scritto da nessuna parte");
            Riga("    la ROM lo chiude nella capsula #" + c.Numero + " (sigillata in " + Dec(r.Secondi, 1) + " s):");
            Riga(ConsoleColor.Cyan, "      puzzle a tempo RSW · N da " + c.BitModulo + " bit · T = " + N0(c.T) + " quadrature = " + c.MesiAttesa + " mesi di calcolo");
            Riga(ConsoleColor.Cyan, "      p, q e φ(N) dimenticati: ora nemmeno il dispositivo può aprirla in fretta");
            Riga(ConsoleColor.Cyan, "      si apre al mese " + apre + " (" + Data(s, apre) + ") · pubblicata in " + Relativo(arc, arc.FileCapsula(c.Numero)));
        }

        // =====================================================================
        // aggiorna
        // =====================================================================
        static int Aggiorna(Archivio arc, string versione)
        {
            if (versione.Length == 0) throw new ErroreUtente("Serve una versione:  testamento aggiorna 1.1");
            StatoDispositivo s = arc.LeggiStato();
            string v = NormalizzaVersione(versione);
            Riga();
            if (s.Rom.Liberato)
            {
                Riga(ConsoleColor.Yellow, "  Il «" + s.Nome + "» è libero dal mese " + s.MeseLiberazione + ": la ROM non genera più capsule.");
                Riga(ConsoleColor.DarkGray, "  Un nuovo firmware, anche del produttore, si installa come qualunque altro:  testamento installa \"" + v + "\"");
                return RIFIUTATO;
            }
            if (string.Equals(v, s.Firmware, StringComparison.OrdinalIgnoreCase))
                throw new ErroreUtente("Il firmware " + v + " è già installato.");

            string prima = s.Firmware;
            ImprontaCodice vecchio = Rom.InVigore(s);
            bool eraMatura = vecchio != null && s.Mese >= vecchio.MeseCreazione + Rom.MESI_ATTESA;

            Riga(ConsoleColor.White, "  Il produttore rilascia il firmware " + v + " · mese " + s.Mese + " · " + Data(s, s.Mese));
            Riga("  Firmware " + prima + " → " + v + " (firma del produttore verificata dal bootloader).");
            s.Firmware = v;
            s.FirmwareUfficiale = true;
            s.MeseUltimoAggiornamento = s.Mese;
            AggiungiStoria(s, v, true);

            Riga();
            Riga("  La ROM vede cambiare il firmware e ruota il codice di liberazione:");
            Rom.Sigillatura r;
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
                r = Rom.NuovoTestamento(s, v, rng);
            arc.SalvaCapsula(r.Capsula);
            arc.SalvaStato(s);

            if (r.Scaduto != null)
                Riga(ConsoleColor.Yellow, "    codice #" + r.Scaduto.Numero + " (" + r.Scaduto.Firmware + ") → SCADUTO: da ora non sblocca più nulla");
            Riga("    nuovo codice #" + r.Impronta.Numero + ", generato dalla ROM, non dal produttore");
            MostraSigillatura(arc, s, r);
            Riga();
            if (eraMatura)
            {
                Riga(ConsoleColor.Yellow, "  Nota: la capsula #" + vecchio.Numero + " era già matura. Chi voleva liberare il dispositivo con il suo codice");
                Riga(ConsoleColor.Yellow, "  doveva farlo prima di accettare questo aggiornamento: ora quel codice è scaduto.");
            }
            Riga(ConsoleColor.DarkGray, "  Il produttore ha distribuito il firmware, non il codice: quello lo conosce solo la capsula.");
            Riga(ConsoleColor.DarkGray, "  Il conto alla rovescia riparte da capo: " + Rom.MESI_ATTESA + " mesi da oggi.");
            return OK;
        }

        // =====================================================================
        // tempo
        // =====================================================================
        static int Tempo(Archivio arc, string arg)
        {
            StatoDispositivo s = arc.LeggiStato();
            if (arg.Length == 0)
            {
                Riga();
                Riga("  Siamo al mese " + s.Mese + " dalla nascita del «" + s.Nome + "» · " + Data(s, s.Mese) + ".");
                return OK;
            }
            int mesi;
            if (!int.TryParse(arg, NumberStyles.Integer, INV, out mesi) || mesi < 0 || mesi > 1200)
                throw new ErroreUtente("Numero di mesi non valido: '" + arg + "'. Esempio:  testamento tempo 6");

            int prima = s.Mese;
            s.Mese += mesi;
            arc.SalvaStato(s);

            Riga();
            Riga(ConsoleColor.Magenta, "  Passano " + Mesi(mesi) + " (simulazione). Siamo al mese " + s.Mese + " · " + Data(s, s.Mese) + ".");
            VoceStoria uff = UltimaUfficiale(s);
            int senza = s.Mese - s.MeseUltimoAggiornamento;
            if (!s.Rom.Liberato)
                Riga(ConsoleColor.DarkGray, "  Ultimo aggiornamento ufficiale: " + uff.Firmware + " al mese " + uff.Mese + (senza > 0 ? ", " + Mesi(senza) + " fa." : ", questo mese."));

            bool evento = false;
            foreach (ImprontaCodice imp in s.Rom.Codici)
            {
                int apre = imp.MeseCreazione + Rom.MESI_ATTESA;
                if (apre <= prima || apre > s.Mese) continue;
                evento = true;
                Riga("  · Al mese " + apre + " la capsula #" + imp.Numero + " ha compiuto " + Rom.MESI_ATTESA + " mesi: ora chiunque può aprirla.");
                if (s.Rom.Liberato)
                    Riga(ConsoleColor.DarkGray, "    Il dispositivo però è già libero.");
                else if (imp.Numero == s.Rom.CodiceInVigore)
                {
                    Riga(ConsoleColor.Green, "    Contiene il codice in vigore: nessun aggiornamento è arrivato dopo di lei.");
                    Riga(ConsoleColor.Green, "    Chi la apre (testamento apri " + imp.Numero + ") può liberare il «" + s.Nome + "».");
                }
                else
                    Riga(ConsoleColor.DarkYellow, "    Contiene un codice già scaduto: era per " + imp.Firmware + ", poi è arrivato " + imp.ScadutoCon + ".");
            }
            if (!evento && !s.Rom.Liberato)
            {
                ImprontaCodice iv = Rom.InVigore(s);
                int apre = iv.MeseCreazione + Rom.MESI_ATTESA;
                if (s.Mese < apre)
                    Riga(ConsoleColor.DarkGray, "  Senza nuovi aggiornamenti, la capsula #" + iv.Numero + " si aprirà tra " + Mesi(apre - s.Mese) + " (mese " + apre + ").");
                else
                    Riga(ConsoleColor.Cyan, "  La capsula #" + iv.Numero + " è matura da " + Mesi(s.Mese - apre) + ": il «" + s.Nome + "» può essere liberato.");
            }
            return OK;
        }

        // =====================================================================
        // stato
        // =====================================================================
        static int Stato(Archivio arc)
        {
            StatoDispositivo s = arc.LeggiStato();
            VoceStoria uff = UltimaUfficiale(s);
            int senza = s.Mese - s.MeseUltimoAggiornamento;
            ImprontaCodice iv = Rom.InVigore(s);
            int apre = iv.MeseCreazione + Rom.MESI_ATTESA;

            Riga();
            Riga(ConsoleColor.White, "  TESTAMENTO · «" + s.Nome + "» · mese " + s.Mese + " dalla nascita · " + Data(s, s.Mese));
            Riga();
            if (s.Rom.Liberato)
                Campo("Stato", "LIBERO", ConsoleColor.Green);
            else if (s.Mese >= apre)
                Campo("Stato", "LIBERABILE: l'ultima capsula è matura", ConsoleColor.Cyan);
            else
                Campo("Stato", "BLOCCATO, sotto il controllo del produttore", ConsoleColor.Yellow);
            Campo("Firmware", s.Firmware + (s.FirmwareUfficiale ? " (ufficiale)" : " (non ufficiale, scelto dal proprietario)"), ConsoleColor.Gray);
            if (s.Rom.Liberato)
                Campo("Bootloader", SBLOCCATO + " dal mese " + s.MeseLiberazione, ConsoleColor.Green);
            else
                Campo("Bootloader", BLOCCATO, ConsoleColor.Yellow);
            Campo("Ultimo aggiornamento", uff.Firmware + " al mese " + uff.Mese + (senza > 0 ? ", " + Mesi(senza) + " fa" : ", questo mese"), ConsoleColor.Gray);
            if (s.Rom.Liberato)
                Campo("Codice usato", "#" + iv.Numero + " · impronta " + Abbrevia(iv.Impronta) + " · il fusibile della ROM è bruciato", ConsoleColor.Gray);
            else
                Campo("Codice in vigore", "#" + iv.Numero + " · impronta " + Abbrevia(iv.Impronta) + " (il codice sta solo nella capsula)", ConsoleColor.Gray);
            Riga();

            string formato = "  {0,-8} {1,-8} {2,-9} {3,-9} {4}";
            Riga(ConsoleColor.DarkGray, string.Format(formato, "CAPSULA", "CREATA", "FIRMWARE", "SI APRE", "STATO"));
            foreach (ImprontaCodice imp in s.Rom.Codici)
            {
                Capsula c = arc.LeggiCapsula(imp.Numero);
                LavoroCapsula w = arc.LeggiLavoro(imp.Numero);
                bool aperta = c != null && w != null && w.Fatte >= c.T;
                bool inVigore = imp.Numero == s.Rom.CodiceInVigore && imp.MeseScadenza < 0;
                int siApre = imp.MeseCreazione + Rom.MESI_ATTESA;
                string st;
                ConsoleColor col;
                if (c == null)
                {
                    st = "capsula mancante!";
                    col = ConsoleColor.Red;
                }
                else if (aperta)
                {
                    if (inVigore && s.Rom.Liberato) { st = "aperta · valida: ha liberato il dispositivo"; col = ConsoleColor.Green; }
                    else if (inVigore) { st = "aperta · VALIDA: può liberare il dispositivo"; col = ConsoleColor.Green; }
                    else { st = "aperta · scaduta (poi è arrivato " + imp.ScadutoCon + ")"; col = ConsoleColor.DarkYellow; }
                }
                else if (s.Mese < siApre)
                {
                    st = "sigillata · mancano " + Mesi(siApre - s.Mese);
                    if (w != null && w.Fatte > 0) st += " · calcolo al " + Percento(w.Fatte, c.T) + "%";
                    col = ConsoleColor.Gray;
                }
                else
                {
                    st = "sigillata · apribile ora (" + (inVigore ? "codice in vigore" : "codice scaduto") + ")";
                    col = inVigore ? ConsoleColor.Cyan : ConsoleColor.Gray;
                }
                Riga(col, string.Format(formato, "#" + imp.Numero, "mese " + imp.MeseCreazione, imp.Firmware, "mese " + siApre, st));
            }
            Riga();

            if (s.Rom.Liberato)
            {
                Riga(ConsoleColor.Green, "  Il «" + s.Nome + "» è LIBERO dal mese " + s.MeseLiberazione + ": gira " + s.Firmware + ".");
                Riga(ConsoleColor.Green, "  Il bootloader accetta qualunque firmware, per sempre.");
                Riga(ConsoleColor.DarkGray, "  Certificato: " + Relativo(arc, arc.FileCertificato));
            }
            else if (s.Mese < apre)
            {
                int fatti = s.Mese - iv.MeseCreazione;
                Pezzo(ConsoleColor.Gray, "  Conto alla rovescia  [");
                Pezzo(ConsoleColor.Cyan, BarraTesto(fatti, Rom.MESI_ATTESA, Rom.MESI_ATTESA));
                Riga(ConsoleColor.Gray, "]  " + fatti + " di " + Rom.MESI_ATTESA + " mesi senza aggiornamenti");
                Riga("  Se il produttore non rilascia altri aggiornamenti, la capsula #" + iv.Numero + " si aprirà tra " + Mesi(apre - s.Mese));
                Riga("  (mese " + apre + " · " + Data(s, apre) + ") e chiunque potrà liberare il «" + s.Nome + "».");
                Riga(ConsoleColor.DarkGray, "  Ogni nuovo aggiornamento fa ripartire il conto da capo: finché il produttore se ne prende cura,");
                Riga(ConsoleColor.DarkGray, "  decide lui che cosa gira sul dispositivo.");
            }
            else
            {
                Pezzo(ConsoleColor.Gray, "  Conto alla rovescia  [");
                Pezzo(ConsoleColor.Cyan, BarraTesto(1, 1, Rom.MESI_ATTESA));
                Riga(ConsoleColor.Gray, "]  finito: " + Mesi(senza) + " senza aggiornamenti");
                Riga(ConsoleColor.Cyan, "  La capsula #" + iv.Numero + " è matura e contiene il codice in vigore.");
                Riga(ConsoleColor.Cyan, "  Chiunque può aprirla (testamento apri " + iv.Numero + ") e liberare il «" + s.Nome + "».");
            }
            return OK;
        }

        // =====================================================================
        // apri
        // =====================================================================
        static int Apri(Archivio arc, string arg)
        {
            int n;
            if (!int.TryParse(arg.TrimStart('#'), NumberStyles.Integer, INV, out n))
                throw new ErroreUtente("Quale capsula? Esempio:  testamento apri 1");
            StatoDispositivo s = arc.LeggiStato();
            Capsula c = arc.LeggiCapsula(n);
            if (c == null)
                throw new ErroreUtente("La capsula #" + n + " non esiste. Questo dispositivo ne ha " + s.Rom.Codici.Count + " (da 1 a " + s.Rom.Codici.Count + ").");

            LavoroCapsula w = arc.LeggiLavoro(n);
            if (w == null || w.Fatte < 0 || w.Fatte > c.T || string.IsNullOrEmpty(w.X))
            {
                w = new LavoroCapsula();
                w.Numero = n;
                w.Fatte = 0;
                w.X = c.A;
                w.Secondi = 0;
                w.MeseApertura = -1;
            }

            int apre = c.MeseCreazione + c.MesiAttesa;
            int trascorsi = s.Mese - c.MeseCreazione;
            long consentite = trascorsi >= c.MesiAttesa ? c.T : (long)Math.Floor((double)c.T * Math.Max(0, trascorsi) / c.MesiAttesa);

            Riga();
            Riga(ConsoleColor.White, "  Capsula #" + n + " · creata al mese " + c.MeseCreazione + " con il firmware " + c.Firmware + " · si apre al mese " + apre);
            Riga(ConsoleColor.DarkGray, "  Puzzle RSW: " + N0(c.T) + " quadrature modulo N (" + c.BitModulo + " bit), una dopo l'altra.");
            Riga(ConsoleColor.DarkGray, "  Senza p e q (che la ROM ha dimenticato) non ci sono scorciatoie.");

            if (w.Fatte >= c.T)
            {
                Riga(ConsoleColor.DarkGray, "  Già aperta al mese " + w.MeseApertura + " dopo " + Dec(w.Secondi, 1) + " s di calcolo: rileggo il risultato salvato.");
            }
            else
            {
                if (trascorsi < c.MesiAttesa)
                {
                    Riga("  Sono passati " + Mesi(Math.Max(0, trascorsi)) + " dei " + c.MesiAttesa + " necessari: il calcolo, partito quando la capsula è stata");
                    Riga("  pubblicata, può essere arrivato solo al " + Percento(consentite, c.T) + "%.");
                }
                if (w.Fatte > 0)
                    Riga(ConsoleColor.DarkGray, "  Riprendo il calcolo salvato: " + N0(w.Fatte) + " quadrature già fatte (" + Percento(w.Fatte, c.T) + "%).");

                if (consentite > w.Fatte)
                {
                    long daFare = consentite - w.Fatte;
                    if (s.QuadratureAlSecondo > 0)
                        Riga(ConsoleColor.DarkGray, "  Da calcolare adesso: " + N0(daFare) + " quadrature, circa " + Dec(daFare / s.QuadratureAlSecondo, 1) + " s su questo PC.");
                    Calcola(arc, c, w, consentite);
                }
                else
                {
                    Riga(ConsoleColor.DarkGray, "  Il calcolo è già arrivato fin dove il calendario permette.");
                    Barra ferma = new Barra(c.T, c.MesiAttesa);
                    ferma.Fine(w.Fatte, 0);
                }

                if (w.Fatte < c.T)
                {
                    long mancano = c.T - w.Fatte;
                    Riga();
                    Riga(ConsoleColor.Yellow, "  Ancora sigillata: mancano " + N0(mancano) + " quadrature, cioè " + Mesi(apre - s.Mese) + " di calcolo.");
                    Riga("  Non si può accelerare: ogni quadratura ha bisogno del risultato della precedente,");
                    Riga("  quindi mille computer non vanno più veloci di uno.");
                    Riga(ConsoleColor.DarkGray, "  Il lavoro è salvato in " + Relativo(arc, arc.FileLavoro(n)) + ": si riprende da qui (testamento apri " + n + ").");
                    return RIFIUTATO;
                }
            }

            // Tutte le T quadrature sono fatte: x = b = a^(2^T) mod N.
            byte[] codice;
            try
            {
                codice = c.Apri(Hex.ABig(w.X));
                if (codice.Length != Codice.BYTE) throw new CapsulaManomessaException("il contenuto non è un codice da 128 bit");
            }
            catch (CapsulaManomessaException e)
            {
                Riga();
                Riga(ConsoleColor.Red, "  CAPSULA MANOMESSA: " + e.Message + ".");
                Riga(ConsoleColor.Red, "  Il contenuto non è affidabile e non viene mostrato.");
                Riga(ConsoleColor.DarkGray, "  (Se sospetti del calcolo salvato, cancella " + Relativo(arc, arc.FileLavoro(n)) + " e ricalcola.)");
                return MANOMESSA;
            }
            if (w.MeseApertura < 0)
            {
                w.MeseApertura = s.Mese;
                arc.SalvaLavoro(w);
            }

            string testo = Codice.Formatta(codice);
            Array.Clear(codice, 0, codice.Length);
            Riga(ConsoleColor.Green, "  Chiave = SHA-256(b) · HMAC-SHA256 verificato: la capsula è integra e la chiave è giusta.");
            Riga();
            Pezzo(ConsoleColor.Gray, "  Codice di liberazione #" + n + ":   ");
            Riga(ConsoleColor.White, testo);
            Riga();

            if (s.Rom.Liberato)
                Riga(ConsoleColor.DarkGray, "  Il «" + s.Nome + "» è già libero dal mese " + s.MeseLiberazione + ".");
            else if (n == s.Rom.CodiceInVigore)
            {
                Riga(ConsoleColor.Green, "  Dopo questa capsula non è arrivato nessun aggiornamento: il codice è ancora in vigore.");
                Riga(ConsoleColor.Green, "  Per liberare il «" + s.Nome + "»:  testamento sblocca " + testo);
            }
            else
            {
                Riga(ConsoleColor.Yellow, "  Dopo questa capsula il firmware è cambiato (" + c.Firmware + " → " + s.Firmware + "):");
                Riga(ConsoleColor.Yellow, "  per la regola della ROM questo codice è già scaduto.");
                Riga(ConsoleColor.DarkGray, "  Il dispositivo lo confermerà:  testamento sblocca " + testo);
            }

            StringBuilder f = new StringBuilder();
            f.AppendLine("Testamento · codice di liberazione pubblicato");
            f.AppendLine();
            f.AppendLine("Dispositivo:  «" + s.Nome + "»");
            f.AppendLine("Capsula:      #" + n + ", creata al mese " + c.MeseCreazione + " con il firmware " + c.Firmware);
            f.AppendLine("Aperta:       al mese " + w.MeseApertura + ", dopo " + N0(c.T) + " quadrature sequenziali (" + Dec(w.Secondi, 1) + " s su questo PC)");
            f.AppendLine("Codice:       " + testo);
            Json.ScriviTesto(arc.FileCodice(n), f.ToString(), true);
            Riga(ConsoleColor.DarkGray, "  Il codice ora è pubblico: " + Relativo(arc, arc.FileCodice(n)));
            return OK;
        }

        // Le quadrature vere, con barra di avanzamento e salvataggio periodico del lavoro.
        static void Calcola(Archivio arc, Capsula c, LavoroCapsula w, long finoA)
        {
            BigInteger n = c.ModuloN();
            BigInteger x = Hex.ABig(w.X);
            long partenza = w.Fatte;
            double secondiPrima = w.Secondi;
            Barra barra = new Barra(c.T, c.MesiAttesa);
            Stopwatch sw = Stopwatch.StartNew();
            double ultimoSalvataggio = 0;

            x = PuzzleRsw.Quadrature(x, finoA - partenza, n, 2000, (fatte, corrente) =>
            {
                barra.Aggiorna(partenza + fatte);
                double t = sw.Elapsed.TotalSeconds;
                if (t - ultimoSalvataggio >= 2.0)
                {
                    ultimoSalvataggio = t;
                    w.Fatte = partenza + fatte;
                    w.X = Hex.DaBig(corrente);
                    w.Secondi = secondiPrima + t;
                    arc.SalvaLavoro(w);
                }
            });
            double durata = sw.Elapsed.TotalSeconds;
            w.Fatte = finoA;
            w.X = Hex.DaBig(x);
            w.Secondi = secondiPrima + durata;
            arc.SalvaLavoro(w);
            barra.Fine(finoA, durata);
        }

        // =====================================================================
        // sblocca
        // =====================================================================
        static int Sblocca(Archivio arc, string testo)
        {
            if (testo.Length == 0) throw new ErroreUtente("Serve il codice:  testamento sblocca 7F3A-19C2-...");
            StatoDispositivo s = arc.LeggiStato();
            Riga();
            if (s.Rom.Liberato)
            {
                Riga(ConsoleColor.Green, "  Il «" + s.Nome + "» è già libero dal mese " + s.MeseLiberazione + ": il bootloader è SBLOCCATO.");
                return OK;
            }
            byte[] codice;
            if (!Codice.ProvaALeggere(testo, out codice))
            {
                Riga(ConsoleColor.Red, "  Codice rifiutato: «" + testo + "» non è un codice di liberazione.");
                Riga(ConsoleColor.DarkGray, "  Un codice ha 32 cifre esadecimali (128 bit), per esempio 7F3A-19C2-0B6E-D451-8A2F-3C90-E7B1-5D04.");
                Riga("  Bootloader: resta BLOCCATO.");
                return RIFIUTATO;
            }

            Riga("  Il dispositivo calcola SHA-256(sale || codice) e lo confronta con le impronte nella ROM...");
            ImprontaCodice imp;
            Rom.Esito esito = Rom.Verifica(s, codice, out imp);
            Array.Clear(codice, 0, codice.Length);

            if (esito == Rom.Esito.Valido)
            {
                Riga(ConsoleColor.Green, "  Corrisponde all'impronta del codice #" + imp.Numero + ", quello in vigore.");
                Riga();
                Riga(ConsoleColor.Green, "  Bootloader: BLOCCATO → SBLOCCATO");
                s.Bootloader = SBLOCCATO;
                s.Rom.Liberato = true;
                s.MeseLiberazione = s.Mese;
                string cert = Certificato(s, imp);
                Json.ScriviTesto(arc.FileCertificato, cert.Replace("\n", "\r\n"), true);
                arc.SalvaStato(s);
                Riga();
                foreach (string r in cert.Split('\n')) Riga(ConsoleColor.Yellow, "  " + r);
                Riga();
                Riga(ConsoleColor.DarkGray, "  Certificato salvato in " + Relativo(arc, arc.FileCertificato));
                Riga("  Da ora il bootloader accetta qualunque firmware:  testamento installa \"<firmware>\"");
                return OK;
            }
            if (esito == Rom.Esito.Scaduto)
            {
                Riga(ConsoleColor.Red, "  Codice scaduto: il dispositivo è stato aggiornato dopo quella capsula (" + imp.Firmware + " → " + s.Firmware + ").");
                Riga("  È il codice #" + imp.Numero + ": valeva finché il firmware era " + imp.Firmware + ", fino al mese " + imp.MeseScadenza + ", quando è arrivato " + imp.ScadutoCon + ".");
                Riga("  Bootloader: resta BLOCCATO.");
                Riga(ConsoleColor.DarkGray, "  Finché il produttore aggiorna, chi apre una capsula trova sempre un codice già scaduto.");
                return RIFIUTATO;
            }
            Riga(ConsoleColor.Red, "  Codice rifiutato: non corrisponde a nessun codice generato da questo dispositivo.");
            Riga("  Bootloader: resta BLOCCATO.");
            Riga(ConsoleColor.DarkGray, "  Tirare a indovinare è inutile: i codici possibili sono 2^128,");
            Riga(ConsoleColor.DarkGray, "  circa 340 miliardi di miliardi di miliardi di miliardi. Provandone mille miliardi al secondo");
            Riga(ConsoleColor.DarkGray, "  servirebbero in media " + Scientifico(Math.Pow(2, 127) / 1e12 / SecondiInUnAnno()) + " anni (l'universo ne ha 1,4 × 10^10).");
            Riga(ConsoleColor.DarkGray, "  Per vederlo con i numeri di questo PC:  testamento indovina");
            return RIFIUTATO;
        }

        static string Certificato(StatoDispositivo s, ImprontaCodice imp)
        {
            VoceStoria uff = UltimaUfficiale(s);
            List<string> aggiornamenti = new List<string>();
            foreach (VoceStoria v in s.Storia) if (v.Ufficiale && v.Mese > 0) aggiornamenti.Add(v.Firmware);
            int senza = s.Mese - s.MeseUltimoAggiornamento;
            string linea = new string('═', 66);
            StringBuilder b = new StringBuilder();
            b.Append(new string('═', 19)).Append(" CERTIFICATO DI LIBERAZIONE ").Append(new string('═', 19)).Append('\n');
            b.Append("Dispositivo                 «" + s.Nome + "»\n");
            b.Append("Nato                        mese 0 (" + Data(s, 0) + ") con il firmware v1.0\n");
            b.Append("Ultimo firmware ufficiale   " + uff.Firmware + ", mese " + uff.Mese + " (" + Data(s, uff.Mese) + ")\n");
            b.Append("Aggiornamenti ricevuti      " + aggiornamenti.Count + (aggiornamenti.Count > 0 ? " (" + string.Join(", ", aggiornamenti.ToArray()) + ")" : "") + "\n");
            b.Append("Liberato                    mese " + s.Mese + " (" + Data(s, s.Mese) + "), dopo " + Mesi(senza) + " senza aggiornamenti\n");
            b.Append("Chiave                      codice #" + imp.Numero + " dalla capsula #" + imp.Numero + " · impronta " + Abbrevia(imp.Impronta) + "\n");
            b.Append("\n");
            b.Append("Il produttore ha smesso di aggiornare questo dispositivo. Come\n");
            b.Append("prevede la sua ROM di avvio, il codice chiuso nell'ultima capsula\n");
            b.Append("è diventato leggibile, e da oggi il bootloader accetta qualunque\n");
            b.Append("firmware. Nessuno ha dovuto chiedere il permesso: è bastato il tempo.\n");
            b.Append(linea);
            return b.ToString();
        }

        // =====================================================================
        // installa
        // =====================================================================
        static int Installa(Archivio arc, string firmware)
        {
            if (firmware.Length == 0) throw new ErroreUtente("Serve il nome del firmware:  testamento installa \"FirmwareLibero 1.0\"");
            StatoDispositivo s = arc.LeggiStato();
            Riga();
            if (s.Bootloader != SBLOCCATO)
            {
                Riga(ConsoleColor.Red, "  Installazione rifiutata: il bootloader è BLOCCATO.");
                Riga("  «" + firmware + "» non porta la firma del produttore,");
                Riga("  e oggi il «" + s.Nome + "» accetta solo firmware firmato.");
                ImprontaCodice iv = Rom.InVigore(s);
                int apre = iv.MeseCreazione + Rom.MESI_ATTESA;
                if (s.Mese < apre)
                    Riga(ConsoleColor.DarkGray, "  Se il produttore non aggiorna più, il codice per sbloccarlo uscirà dalla capsula #" + iv.Numero + "\n  al mese " + apre + " (tra " + Mesi(apre - s.Mese) + ").");
                else
                    Riga(ConsoleColor.DarkGray, "  La capsula #" + iv.Numero + " è già matura: aprila (testamento apri " + iv.Numero + ")\n  e usa il suo codice con  testamento sblocca.");
                return RIFIUTATO;
            }
            string prima = s.Firmware;
            s.Firmware = firmware;
            s.FirmwareUfficiale = false;
            AggiungiStoria(s, firmware, false);
            arc.SalvaStato(s);
            Riga(ConsoleColor.Green, "  Firmware " + prima + " → " + firmware);
            Riga("  Il bootloader è sbloccato: nessuna firma richiesta. Il «" + s.Nome + "» ora è LIBERO.");
            Riga(ConsoleColor.DarkGray, "  Può ricevere correzioni e funzioni nuove da chiunque, anche se il produttore non esiste più.");
            return OK;
        }

        // =====================================================================
        // indovina: forza bruta vera, per qualche secondo
        // =====================================================================
        static int Indovina(Archivio arc, string arg)
        {
            double secondi = 2;
            if (arg.Length > 0 && !double.TryParse(arg.Replace(',', '.'), NumberStyles.Float, INV, out secondi))
                throw new ErroreUtente("Durata non valida: '" + arg + "'. Esempio:  testamento indovina 3");
            secondi = Math.Max(0.5, Math.Min(60, secondi));
            StatoDispositivo s = arc.LeggiStato();
            ImprontaCodice iv = Rom.InVigore(s);
            byte[] sale = Hex.AByte(iv.Sale);
            byte[] bersaglio = Hex.AByte(iv.Impronta);
            int fili = Environment.ProcessorCount;

            Riga();
            Riga(ConsoleColor.White, "  Provo a indovinare il codice #" + iv.Numero + " per " + Dec(secondi, 1) + " s, con " + fili + " processori logici in parallelo...");

            long totale = 0;
            int trovati = 0;
            Stopwatch sw = Stopwatch.StartNew();
            Thread[] thread = new Thread[fili];
            for (int t = 0; t < fili; t++)
            {
                thread[t] = new Thread(() =>
                {
                    byte[] buf = new byte[sale.Length + Codice.BYTE];
                    sale.CopyTo(buf, 0);
                    using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
                    {
                        byte[] inizio = Codice.Nuovo(rng);
                        inizio.CopyTo(buf, sale.Length);
                    }
                    long mie = 0;
                    using (SHA256 h = SHA256.Create())
                    {
                        while (sw.Elapsed.TotalSeconds < secondi)
                        {
                            for (int k = 0; k < 1024; k++)
                            {
                                for (int j = sale.Length; j < buf.Length; j++) if (++buf[j] != 0) break;
                                if (Codice.Uguali(h.ComputeHash(buf), bersaglio)) Interlocked.Increment(ref trovati);
                            }
                            mie += 1024;
                        }
                    }
                    Interlocked.Add(ref totale, mie);
                });
                thread[t].Start();
            }
            foreach (Thread t in thread) t.Join();
            double durata = sw.Elapsed.TotalSeconds;
            double ritmo = totale / durata;
            double anni = Math.Pow(2, 127) / ritmo / SecondiInUnAnno();

            Riga("  Tentativi: " + N0(totale) + " in " + Dec(durata, 1) + " s (" + N0(ritmo) + " al secondo) · codici giusti trovati: " + trovati);
            Riga("  Codici possibili: 2^128 = " + Raggruppa(BigInteger.Pow(2, 128)));
            Riga("  In media ne servono la metà, 2^127. A questo ritmo: " + Scientifico(anni) + " anni.");
            Riga("  Con un miliardo di PC come questo: " + Scientifico(anni / 1e9) + " anni. L'universo ne ha 1,4 × 10^10.");
            Riga(ConsoleColor.Green, "  Aspettare è molto più veloce: al massimo " + Rom.MESI_ATTESA + " mesi dall'ultimo aggiornamento.");
            return OK;
        }

        // =====================================================================
        // taratura
        // =====================================================================
        static string FileTaratura()
        {
            return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "taratura.json");
        }

        static long QuadratureAlMese(out double alSecondo, out string origine)
        {
            string env = Environment.GetEnvironmentVariable("TESTAMENTO_QUADRATURE_AL_MESE");
            if (!string.IsNullOrEmpty(env))
            {
                long q;
                if (!long.TryParse(env, NumberStyles.Integer, INV, out q) || q < 1)
                    throw new ErroreUtente("TESTAMENTO_QUADRATURE_AL_MESE non valida: '" + env + "'");
                alSecondo = 0;          // velocità sconosciuta: niente stime in secondi
                origine = "imposta da TESTAMENTO_QUADRATURE_AL_MESE";
                return q;
            }
            Taratura t = null;
            string f = FileTaratura();
            if (File.Exists(f))
            {
                try { t = Json.Leggi<Taratura>(f); } catch { t = null; }
            }
            if (t == null || t.QuadratureAlSecondo <= 0)
            {
                Riga();
                Riga(ConsoleColor.DarkGray, "  Prima esecuzione: misuro la velocità di questo PC...");
                t = Misura(1.5);
                Salva(t);
                origine = "misurata ora, salvata in bin\\taratura.json";
            }
            else
            {
                // Un portatile a batteria può andare a metà velocità: una prova breve
                // dice se la taratura salvata vale ancora.
                double prova = Misura(0.3).QuadratureAlSecondo;
                double rapporto = prova / t.QuadratureAlSecondo;
                if (rapporto < 0.7 || rapporto > 1.3)
                {
                    Riga();
                    Riga(ConsoleColor.DarkGray, "  La velocità di questo PC è cambiata dall'ultima taratura (" + N0(t.QuadratureAlSecondo)
                        + " → circa " + N0(prova) + " quadrature/s): la rimisuro...");
                    t = Misura(1.5);
                    Salva(t);
                    origine = "rimisurata ora, salvata in bin\\taratura.json";
                }
                else
                    origine = "taratura del " + t.Misurata + ", verificata ora";
            }
            alSecondo = t.QuadratureAlSecondo;
            return Math.Max(1, (long)Math.Round(t.QuadratureAlSecondo * SECONDI_PER_MESE));
        }

        static Taratura Misura(double durata)
        {
            BigInteger n, x;
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
            {
                n = Primi.Casuale(rng, 1024) | BigInteger.One;
                x = Primi.CasualeSotto(rng, n);
            }
            x = PuzzleRsw.Quadrature(x, 5000, n, 5000, null);          // riscaldamento
            Stopwatch sw = Stopwatch.StartNew();
            long fatte = 0;
            while (sw.Elapsed.TotalSeconds < durata)
            {
                x = PuzzleRsw.Quadrature(x, 5000, n, 5000, null);
                fatte += 5000;
            }
            Taratura t = new Taratura();
            t.QuadratureAlSecondo = Math.Round(fatte / sw.Elapsed.TotalSeconds);
            t.BitModulo = 1024;
            t.Misurata = DateTime.Now.ToString("d MMMM yyyy, HH:mm", IT);
            return t;
        }

        static void Salva(Taratura t)
        {
            try { Json.Scrivi(FileTaratura(), t); }
            catch (Exception e) { Riga(ConsoleColor.DarkGray, "  (non riesco a salvare la taratura: " + e.Message + ")"); }
        }

        static int RifaiTaratura()
        {
            Riga();
            Riga(ConsoleColor.DarkGray, "  Misuro la velocità di questo PC (1,5 s di quadrature modulo N da 1024 bit)...");
            Taratura t = Misura(1.5);
            Salva(t);
            long qpm = Math.Max(1, (long)Math.Round(t.QuadratureAlSecondo * SECONDI_PER_MESE));
            Riga("  " + N0(t.QuadratureAlSecondo) + " quadrature al secondo · 1 mese simulato = " + N0(qpm) + " quadrature ≈ " + Dec(SECONDI_PER_MESE, 1) + " s");
            Riga("  Una capsula da " + Rom.MESI_ATTESA + " mesi: " + N0(qpm * Rom.MESI_ATTESA) + " quadrature, circa " + Dec(SECONDI_PER_MESE * Rom.MESI_ATTESA, 1) + " s.");
            Riga(ConsoleColor.DarkGray, "  Salvata in " + FileTaratura() + ". Vale per i dispositivi che nasceranno da ora in poi.");
            return OK;
        }

        // =====================================================================
        // aiuto
        // =====================================================================
        static void Aiuto()
        {
            Riga();
            Riga(ConsoleColor.White, "  TESTAMENTO — l'hardware che si libera da solo quando il produttore lo abbandona");
            Riga();
            Riga("  testamento nasce \"<nome>\"          nuovo dispositivo: firmware v1.0, bootloader bloccato, capsula #1");
            Riga("  testamento aggiorna <versione>     il produttore rilascia un aggiornamento: la ROM ruota il codice");
            Riga("  testamento tempo <mesi>            fa passare il tempo (simulato)");
            Riga("  testamento stato                   firmware, bootloader, capsule e conto alla rovescia");
            Riga("  testamento apri <n>                apre la capsula n facendo davvero le T quadrature");
            Riga("  testamento sblocca <codice>        prova un codice di liberazione");
            Riga("  testamento installa \"<firmware>\"   installa un firmware (solo a bootloader sbloccato)");
            Riga("  testamento indovina [secondi]      forza bruta vera per qualche secondo: per vedere quanto è inutile");
            Riga("  testamento taratura                rimisura la velocità di questo PC");
            Riga();
            Riga(ConsoleColor.DarkGray, "  Per tutti i comandi:  --dispositivo <cartella>  (oppure -Dispositivo; se manca: variabile");
            Riga(ConsoleColor.DarkGray, "  TESTAMENTO_DISPOSITIVO, altrimenti .\\dispositivo)");
            Riga();
        }

        // =====================================================================
        // Utilità
        // =====================================================================
        static void AggiungiStoria(StatoDispositivo s, string firmware, bool ufficiale)
        {
            VoceStoria v = new VoceStoria();
            v.Mese = s.Mese;
            v.Firmware = firmware;
            v.Ufficiale = ufficiale;
            s.Storia.Add(v);
        }

        static VoceStoria UltimaUfficiale(StatoDispositivo s)
        {
            for (int i = s.Storia.Count - 1; i >= 0; i--)
                if (s.Storia[i].Ufficiale) return s.Storia[i];
            VoceStoria v = new VoceStoria();
            v.Mese = 0;
            v.Firmware = "v1.0";
            v.Ufficiale = true;
            return v;
        }

        static string NormalizzaVersione(string v)
        {
            v = v.Trim();
            if (v.Length > 1 && (v[0] == 'v' || v[0] == 'V') && char.IsDigit(v[1])) return "v" + v.Substring(1);
            if (v.Length > 0 && char.IsDigit(v[0])) return "v" + v;
            return v;
        }

        static string Data(StatoDispositivo s, int mese)
        {
            DateTime nascita = new DateTime(s.AnnoNascita, Math.Max(1, Math.Min(12, s.MeseNascita)), 1);
            return nascita.AddMonths(mese).ToString("MMMM yyyy", IT);
        }

        static string Mesi(int n)
        {
            return n == 1 ? "1 mese" : n + " mesi";
        }

        static string N0(double v)
        {
            return Math.Round(v).ToString("N0", IT);
        }

        static string Dec(double v, int cifre)
        {
            return v.ToString("N" + cifre, IT);
        }

        static int Percento(long fatte, long totale)
        {
            if (totale <= 0) return 100;
            return (int)Math.Floor(100.0 * fatte / totale);
        }

        static double SecondiInUnAnno()
        {
            return 365.25 * 24 * 3600;
        }

        static string Scientifico(double v)
        {
            if (v < 1e6) return N0(v);
            int esp = (int)Math.Floor(Math.Log10(v));
            double m = v / Math.Pow(10, esp);
            if (m >= 9.95) { m /= 10; esp++; }
            return m.ToString("0.0", IT) + " × 10^" + esp;
        }

        static string Raggruppa(BigInteger v)
        {
            string d = v.ToString(INV);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < d.Length; i++)
            {
                if (i > 0 && (d.Length - i) % 3 == 0) sb.Append('.');
                sb.Append(d[i]);
            }
            return sb.ToString();
        }

        static string Abbrevia(string hex)
        {
            if (hex == null || hex.Length <= 16) return hex;
            return hex.Substring(0, 12) + "…" + hex.Substring(hex.Length - 4);
        }

        static string Relativo(Archivio arc, string percorso)
        {
            string radice = arc.Radice.TrimEnd('\\') + "\\";
            if (percorso.StartsWith(radice, StringComparison.OrdinalIgnoreCase)) return percorso.Substring(radice.Length);
            return percorso;
        }

        static string BarraTesto(long fatte, long totale, int larghezza)
        {
            int pieni = totale <= 0 ? larghezza : (int)Math.Floor((double)larghezza * fatte / totale);
            pieni = Math.Max(0, Math.Min(larghezza, pieni));
            return new string('█', pieni) + new string('░', larghezza - pieni);
        }

        static void Campo(string etichetta, string valore, ConsoleColor colore)
        {
            Pezzo(ConsoleColor.DarkGray, "  " + etichetta.PadRight(22));
            Riga(colore, valore);
        }

        // --- scrittura a colori (i colori si perdono, senza danni, se l'output è rediretto)
        public static void Riga()
        {
            Console.WriteLine();
        }

        public static void Riga(string testo)
        {
            Console.WriteLine(testo);
        }

        public static void Riga(ConsoleColor colore, string testo)
        {
            Pezzo(colore, testo);
            Console.WriteLine();
        }

        public static void Pezzo(ConsoleColor colore, string testo)
        {
            ConsoleColor prima = ConsoleColor.Gray;
            bool cambiato = false;
            try { prima = Console.ForegroundColor; Console.ForegroundColor = colore; cambiato = true; } catch { }
            Console.Write(testo);
            if (cambiato) { try { Console.ForegroundColor = prima; } catch { } }
        }

        // ---------------------------------------------------------------------
        // Barra di avanzamento delle quadrature
        // ---------------------------------------------------------------------
        sealed class Barra
        {
            const int LARGHEZZA = 20;
            readonly long totale;
            readonly int mesi;
            readonly bool dalVivo;
            readonly Stopwatch orologio = Stopwatch.StartNew();
            long ultimoDisegno = -1000;
            int lunghezzaPrecedente;

            public Barra(long totale, int mesi)
            {
                this.totale = totale;
                this.mesi = mesi;
                bool rediretto = true;
                try { rediretto = Console.IsOutputRedirected; } catch { }
                dalVivo = !rediretto;
            }

            public void Aggiorna(long fatte)
            {
                if (!dalVivo) return;
                long ora = orologio.ElapsedMilliseconds;
                if (ora - ultimoDisegno < 100) return;
                ultimoDisegno = ora;
                Disegna(fatte, orologio.Elapsed.TotalSeconds);
            }

            public void Fine(long fatte, double secondi)
            {
                Disegna(fatte, secondi);
                Console.WriteLine();
            }

            void Disegna(long fatte, double secondi)
            {
                string coda = "] " + Percento(fatte, totale).ToString(INV).PadLeft(3) + "%  "
                    + Dec((double)fatte * mesi / totale, 1) + "/" + mesi + " mesi · "
                    + N0(fatte) + " quadrature · " + Dec(secondi, 1) + " s";
                int lunghezza = 3 + LARGHEZZA + coda.Length;
                if (dalVivo) Console.Write("\r");
                Pezzo(ConsoleColor.Gray, "  [");
                Pezzo(ConsoleColor.Cyan, BarraTesto(fatte, totale, LARGHEZZA));
                Pezzo(ConsoleColor.Gray, coda);
                if (dalVivo && lunghezza < lunghezzaPrecedente) Console.Write(new string(' ', lunghezzaPrecedente - lunghezza));
                lunghezzaPrecedente = lunghezza;
            }
        }
    }
}
