// TESTAMENTO - la crittografia vera del prototipo.
//
//   Primi       numeri primi da 512 bit (Miller-Rabin, generatore casuale del sistema)
//   PuzzleRsw   puzzle a tempo di Rivest, Shamir e Wagner (1996)
//   Sigillo     chiave = SHA-256(b), cifratura AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC)
//   Capsula     il pacchetto pubblico: N, a, T e il codice cifrato
//   Codice      il codice di liberazione da 128 bit e la sua impronta salata
//
// Scritto in C# 5 (il compilatore incluso in .NET Framework 4.8).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;

namespace Testamento
{
    public class CapsulaManomessaException : Exception
    {
        public CapsulaManomessaException(string messaggio) : base(messaggio) { }
    }

    // -------------------------------------------------------------------------
    // Numeri primi
    // -------------------------------------------------------------------------
    public static class Primi
    {
        static readonly int[] piccoli = Setaccio(2000);

        static int[] Setaccio(int limite)
        {
            bool[] composto = new bool[limite + 1];
            List<int> primi = new List<int>();
            for (int i = 2; i <= limite; i++)
            {
                if (composto[i]) continue;
                primi.Add(i);
                for (int j = i * i; j <= limite; j += i) composto[j] = true;
            }
            return primi.ToArray();
        }

        // Intero casuale di esattamente 'bit' bit (il bit più alto è sempre 1).
        public static BigInteger Casuale(RandomNumberGenerator rng, int bit)
        {
            int nb = (bit + 7) / 8;
            byte[] b = new byte[nb + 1];          // un byte in più, a zero: il numero resta positivo
            rng.GetBytes(b);
            b[nb] = 0;
            int eccesso = nb * 8 - bit;
            b[nb - 1] &= (byte)(0xFF >> eccesso);
            b[nb - 1] |= (byte)(0x80 >> eccesso);
            return new BigInteger(b);
        }

        // Intero casuale in [0, limite), con distorsione trascurabile (64 bit in più).
        public static BigInteger CasualeSotto(RandomNumberGenerator rng, BigInteger limite)
        {
            if (limite.Sign <= 0) throw new ArgumentException("limite non positivo");
            byte[] b = new byte[limite.ToByteArray().Length + 8];
            rng.GetBytes(b);
            b[b.Length - 1] = 0;
            return BigInteger.Remainder(new BigInteger(b), limite);
        }

        public static bool ProbabilmentePrimo(BigInteger n, RandomNumberGenerator rng, int giri)
        {
            if (n < 2) return false;
            foreach (int p in piccoli)
            {
                if (n == p) return true;
                if (BigInteger.Remainder(n, p).IsZero) return false;
            }
            BigInteger nMeno1 = n - 1;
            BigInteger d = nMeno1;
            int s = 0;
            while (d.IsEven) { d >>= 1; s++; }
            for (int g = 0; g < giri; g++)
            {
                BigInteger a = 2 + CasualeSotto(rng, n - 3);          // base in [2, n-2]
                BigInteger x = BigInteger.ModPow(a, d, n);
                if (x.IsOne || x == nMeno1) continue;
                bool testimone = true;
                for (int r = 1; r < s; r++)
                {
                    x = BigInteger.Remainder(x * x, n);
                    if (x == nMeno1) { testimone = false; break; }
                    if (x.IsOne) break;
                }
                if (testimone) return false;                          // n è composto, di sicuro
            }
            return true;                                              // errore < 4^-giri
        }

        public static BigInteger GeneraPrimo(RandomNumberGenerator rng, int bit)
        {
            while (true)
            {
                BigInteger c = Casuale(rng, bit);
                c |= BigInteger.One << (bit - 2);   // i due bit alti a 1: p·q ha esattamente 2·bit bit
                c |= BigInteger.One;                // dispari
                if (ProbabilmentePrimo(c, rng, 40)) return c;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Puzzle a tempo RSW
    // -------------------------------------------------------------------------
    // Chi crea il puzzle conosce φ(N) e calcola b = a^(2^T) mod N in un attimo:
    //     e = 2^T mod φ(N),   b = a^e mod N          (teorema di Eulero)
    // Chi non conosce φ(N) deve fare T quadrature modulo N, una dopo l'altra:
    // ogni passo ha bisogno del risultato del precedente, quindi più computer
    // non aiutano. Trovare φ(N) equivale a fattorizzare N.
    public sealed class PuzzleRsw
    {
        public BigInteger N;
        public BigInteger A;
        public BigInteger Phi;      // il segreto: esiste solo mentre la ROM sigilla la capsula
        public long T;

        public static PuzzleRsw Nuovo(RandomNumberGenerator rng, int bitPrimi, long t)
        {
            if (t < 1) throw new ArgumentException("T deve essere almeno 1");
            BigInteger p = Primi.GeneraPrimo(rng, bitPrimi);
            BigInteger q;
            do { q = Primi.GeneraPrimo(rng, bitPrimi); } while (q == p);
            PuzzleRsw z = new PuzzleRsw();
            z.N = p * q;
            z.Phi = (p - 1) * (q - 1);
            z.T = t;
            do { z.A = 2 + Primi.CasualeSotto(rng, z.N - 3); }
            while (!BigInteger.GreatestCommonDivisor(z.A, z.N).IsOne);
            return z;
        }

        // Il ramo veloce: possibile solo conoscendo φ(N).
        public BigInteger RisolviConSegreto()
        {
            if (Phi.IsZero) throw new InvalidOperationException("il segreto è già stato dimenticato");
            return RisolviConPhi(A, T, Phi, N);
        }

        public static BigInteger RisolviConPhi(BigInteger a, long t, BigInteger phi, BigInteger n)
        {
            BigInteger e = BigInteger.ModPow(2, t, phi);
            return BigInteger.ModPow(a, e, n);
        }

        // Dimentica p, q e φ(N). In .NET i BigInteger sono immutabili e non si
        // possono azzerare in memoria: qui si butta il riferimento. Una ROM vera
        // cancellerebbe i registri.
        public void Dimentica()
        {
            Phi = BigInteger.Zero;
        }

        // Il ramo lento: 'quante' quadrature sequenziali, a partire da x.
        // 'ogni' viene chiamata ogni 'passo' quadrature con il totale fatto finora
        // e il valore corrente (serve per la barra e per salvare il lavoro).
        public static BigInteger Quadrature(BigInteger x, long quante, BigInteger n, long passo, Action<long, BigInteger> ogni)
        {
            if (passo < 1) passo = 1;
            long fatte = 0;
            while (fatte < quante)
            {
                long blocco = Math.Min(passo, quante - fatte);
                for (long i = 0; i < blocco; i++) x = BigInteger.Remainder(x * x, n);
                fatte += blocco;
                if (ogni != null) ogni(fatte, x);
            }
            return x;
        }

        public static BigInteger RisolviLento(BigInteger a, long t, BigInteger n)
        {
            return Quadrature(a, t, n, 1 << 20, null);
        }
    }

    // -------------------------------------------------------------------------
    // Cifratura della capsula
    // -------------------------------------------------------------------------
    public static class Sigillo
    {
        static readonly byte[] etichettaAes = Encoding.ASCII.GetBytes("testamento/chiave-aes");
        static readonly byte[] etichettaMac = Encoding.ASCII.GetBytes("testamento/chiave-hmac");

        // K = SHA-256(b), con b scritto in big-endian su tanti byte quanti ne ha N.
        public static byte[] ChiaveDaB(BigInteger b, int byteModulo)
        {
            using (SHA256 h = SHA256.Create())
                return h.ComputeHash(Hex.BigEndian(b, byteModulo));
        }

        // Da K due chiavi indipendenti: una per AES-256, una per HMAC-SHA256.
        public static void Deriva(byte[] k, out byte[] kAes, out byte[] kMac)
        {
            using (HMACSHA256 h = new HMACSHA256(k)) kAes = h.ComputeHash(etichettaAes);
            using (HMACSHA256 h = new HMACSHA256(k)) kMac = h.ComputeHash(etichettaMac);
        }

        public static void Cifra(byte[] k, byte[] intestazione, byte[] chiaro, out byte[] iv, out byte[] cifrato, out byte[] tag)
        {
            byte[] kAes, kMac;
            Deriva(k, out kAes, out kMac);
            using (Aes aes = Aes.Create())
            {
                aes.KeySize = 256;
                aes.Mode = CipherMode.CBC;
                aes.Padding = PaddingMode.PKCS7;
                aes.Key = kAes;
                aes.GenerateIV();
                iv = aes.IV;
                using (ICryptoTransform t = aes.CreateEncryptor())
                    cifrato = t.TransformFinalBlock(chiaro, 0, chiaro.Length);
            }
            tag = Mac(kMac, intestazione, iv, cifrato);
        }

        public static byte[] Decifra(byte[] k, byte[] intestazione, byte[] iv, byte[] cifrato, byte[] tag)
        {
            byte[] kAes, kMac;
            Deriva(k, out kAes, out kMac);
            byte[] atteso = Mac(kMac, intestazione, iv, cifrato);
            if (!Codice.Uguali(atteso, tag))
                throw new CapsulaManomessaException("HMAC non valido: la capsula è stata alterata (o il calcolo che la apre è sbagliato)");
            using (Aes aes = Aes.Create())
            {
                aes.KeySize = 256;
                aes.Mode = CipherMode.CBC;
                aes.Padding = PaddingMode.PKCS7;
                aes.Key = kAes;
                aes.IV = iv;
                using (ICryptoTransform t = aes.CreateDecryptor())
                    return t.TransformFinalBlock(cifrato, 0, cifrato.Length);
            }
        }

        // L'HMAC copre intestazione (numero, dispositivo, firmware, N, a, T...), IV e testo cifrato.
        static byte[] Mac(byte[] kMac, byte[] intestazione, byte[] iv, byte[] cifrato)
        {
            byte[] tutto = new byte[4 + intestazione.Length + iv.Length + cifrato.Length];
            BitConverter.GetBytes(intestazione.Length).CopyTo(tutto, 0);
            intestazione.CopyTo(tutto, 4);
            iv.CopyTo(tutto, 4 + intestazione.Length);
            cifrato.CopyTo(tutto, 4 + intestazione.Length + iv.Length);
            using (HMACSHA256 h = new HMACSHA256(kMac)) return h.ComputeHash(tutto);
        }
    }

    // -------------------------------------------------------------------------
    // La capsula: tutto ciò che contiene è pubblico
    // -------------------------------------------------------------------------
    public class Capsula
    {
        public const string FORMATO = "testamento-capsula-1";

        public string Formato { get; set; }
        public int Numero { get; set; }
        public string Dispositivo { get; set; }
        public string Firmware { get; set; }
        public int MeseCreazione { get; set; }
        public int MesiAttesa { get; set; }
        public int BitModulo { get; set; }
        public string N { get; set; }
        public string A { get; set; }
        public long T { get; set; }
        public string Iv { get; set; }
        public string Cifrato { get; set; }
        public string Hmac { get; set; }

        public byte[] Intestazione()
        {
            CultureInfo inv = CultureInfo.InvariantCulture;
            string s = string.Join("|", new string[] {
                Formato, Numero.ToString(inv), Dispositivo, Firmware, MeseCreazione.ToString(inv),
                MesiAttesa.ToString(inv), BitModulo.ToString(inv), N, A, T.ToString(inv) });
            return Encoding.UTF8.GetBytes(s);
        }

        public BigInteger ModuloN() { return Hex.ABig(N); }
        public BigInteger BaseA() { return Hex.ABig(A); }

        // Chiude 'codice' nella capsula usando il puzzle z (che deve conoscere ancora φ).
        public static Capsula Sigilla(PuzzleRsw z, byte[] codice, int numero, string dispositivo, string firmware, int meseCreazione, int mesiAttesa)
        {
            Capsula c = new Capsula();
            c.Formato = FORMATO;
            c.Numero = numero;
            c.Dispositivo = dispositivo;
            c.Firmware = firmware;
            c.MeseCreazione = meseCreazione;
            c.MesiAttesa = mesiAttesa;
            c.BitModulo = Hex.LunghezzaByte(z.N) * 8;
            c.N = Hex.DaBig(z.N);
            c.A = Hex.DaBig(z.A);
            c.T = z.T;
            BigInteger b = z.RisolviConSegreto();                 // il ramo veloce
            byte[] k = Sigillo.ChiaveDaB(b, c.BitModulo / 8);
            byte[] iv, cifrato, tag;
            Sigillo.Cifra(k, c.Intestazione(), codice, out iv, out cifrato, out tag);
            Array.Clear(k, 0, k.Length);
            c.Iv = Hex.DaByte(iv);
            c.Cifrato = Hex.DaByte(cifrato);
            c.Hmac = Hex.DaByte(tag);
            return c;
        }

        // Apre la capsula dato b = a^(2^T) mod N. Lancia CapsulaManomessaException se l'HMAC non torna.
        public byte[] Apri(BigInteger b)
        {
            if (Formato != FORMATO) throw new CapsulaManomessaException("formato della capsula sconosciuto");
            byte[] k = Sigillo.ChiaveDaB(b, BitModulo / 8);
            return Sigillo.Decifra(k, Intestazione(), Hex.AByte(Iv), Hex.AByte(Cifrato), Hex.AByte(Hmac));
        }
    }

    // -------------------------------------------------------------------------
    // Il codice di liberazione
    // -------------------------------------------------------------------------
    public static class Codice
    {
        public const int BYTE = 16;   // 128 bit

        public static byte[] Nuovo(RandomNumberGenerator rng)
        {
            byte[] c = new byte[BYTE];
            rng.GetBytes(c);
            return c;
        }

        // 7F3A-19C2-...: otto gruppi da quattro cifre esadecimali.
        public static string Formatta(byte[] c)
        {
            string h = Hex.DaByte(c);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < h.Length; i += 4)
            {
                if (i > 0) sb.Append('-');
                sb.Append(h, i, 4);
            }
            return sb.ToString();
        }

        // Accetta trattini, spazi e minuscole. Servono esattamente 32 cifre esadecimali.
        public static bool ProvaALeggere(string testo, out byte[] codice)
        {
            codice = null;
            if (testo == null) return false;
            StringBuilder sb = new StringBuilder();
            foreach (char ch in testo)
            {
                if (ch == '-' || ch == ' ' || ch == '_' || ch == '.') continue;
                if (Uri.IsHexDigit(ch)) sb.Append(char.ToUpperInvariant(ch));
                else return false;
            }
            if (sb.Length != BYTE * 2) return false;
            codice = Hex.AByte(sb.ToString());
            return true;
        }

        // Impronta salata: SHA-256(sale || codice). È tutto ciò che il dispositivo conserva.
        public static byte[] Impronta(byte[] sale, byte[] codice)
        {
            byte[] m = new byte[sale.Length + codice.Length];
            sale.CopyTo(m, 0);
            codice.CopyTo(m, sale.Length);
            using (SHA256 h = SHA256.Create()) return h.ComputeHash(m);
        }

        // Confronto a tempo costante.
        public static bool Uguali(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }
    }

    // -------------------------------------------------------------------------
    // Esadecimale e BigInteger
    // -------------------------------------------------------------------------
    public static class Hex
    {
        public static string DaByte(byte[] b)
        {
            return BitConverter.ToString(b).Replace("-", "");
        }

        public static byte[] AByte(string h)
        {
            if (h == null || h.Length % 2 != 0) throw new FormatException("esadecimale non valido");
            byte[] r = new byte[h.Length / 2];
            for (int i = 0; i < r.Length; i++)
                r[i] = byte.Parse(h.Substring(2 * i, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            return r;
        }

        // Numero di byte significativi di un intero positivo.
        public static int LunghezzaByte(BigInteger v)
        {
            byte[] le = v.ToByteArray();
            int n = le.Length;
            while (n > 1 && le[n - 1] == 0) n--;
            return n;
        }

        public static byte[] BigEndian(BigInteger v, int lunghezza)
        {
            if (v.Sign < 0) throw new ArgumentException("numero negativo");
            byte[] le = v.ToByteArray();
            byte[] r = new byte[lunghezza];
            for (int i = 0; i < le.Length; i++)
            {
                if (i < lunghezza) r[lunghezza - 1 - i] = le[i];
                else if (le[i] != 0) throw new ArgumentException("numero troppo grande");
            }
            return r;
        }

        public static string DaBig(BigInteger v)
        {
            return DaByte(BigEndian(v, LunghezzaByte(v)));
        }

        public static BigInteger ABig(string h)
        {
            byte[] be = AByte(h);
            byte[] le = new byte[be.Length + 1];
            for (int i = 0; i < be.Length; i++) le[i] = be[be.Length - 1 - i];
            return new BigInteger(le);
        }
    }
}
