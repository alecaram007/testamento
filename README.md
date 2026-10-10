# Testamento

Un simulatore, con crittografia vera, di un dispositivo che si libera da solo se il produttore smette di aggiornarlo per 18 mesi: il codice di sblocco è chiuso in una capsula a tempo che nessuno può aprire prima.
Per provarlo: **su Mac** (Node.js 20 o successivo) `cd mac && npm start` apre il cruscotto web, `node demo.mjs` la demo; **su Windows** doppio clic su `demo.cmd` (la prima volta compila da solo il programma con .NET Framework 4.8, già presente in Windows 10 e 11).

**L'hardware che si libera da solo quando il produttore lo abbandona.**

Quando un'azienda smette di aggiornare un dispositivo, o fallisce, l'oggetto diventa un rifiuto bloccato. Il suo bootloader accetta solo firmware firmato da qualcuno che non c'è più, e nessuno può installarci altro. Testamento scrive nella ROM di avvio una specie di testamento: **se gli aggiornamenti si fermano per 18 mesi, il dispositivo si libera da solo**. Non serve la buona volontà dell'azienda, e non serve nemmeno che l'azienda esista ancora.

Il prototipo è nato per Windows e non richiede nessuna installazione: la versione per Mac, in Node.js, è nella cartella `mac` (vedi [Su Mac](#su-mac)). È scritto in C# e viene compilato con il compilatore già incluso in .NET Framework 4.8. La crittografia è vera: numeri primi da 512 bit, un puzzle a tempo di Rivest, Shamir e Wagner, AES-256 e HMAC-SHA256.

## Provalo subito

Fai doppio clic su **`demo.cmd`**.

La demo racconta la vita di un termostato, il «Caldo 3000»:

1. nasce con il firmware v1.0 (capsula #1);
2. al mese 6 riceve la v1.1 (capsula #2), al mese 12 la v1.2 (capsula #3);
3. un curioso prova a indovinare il codice, poi ad aprire la capsula #1 prima del tempo, e non ci riesce;
4. al mese 14 il produttore fallisce e da quel momento non arriva più nessun aggiornamento;
5. al mese 18 il curioso finisce di aprire la capsula #1, ma il codice che ne esce è scaduto;
6. al mese 32 la comunità apre la capsula #3. Il suo codice è valido, il bootloader si sblocca e sul termostato viene installato «FirmwareLibero 1.0».

Dura circa 30–35 secondi, di cui circa 22 di calcolo vero (due capsule da circa 11 secondi). La prima volta compila `bin\testamento.exe` (il repository contiene solo i sorgenti) e misura anche la velocità del PC. I file del termostato restano in `demo\caldo-3000`. Nel repository quella cartella c'è già: è il risultato di una demo vera, e i test della versione Mac la usano per provare la compatibilità dei file. Ogni nuova demo la ricrea.

## Usarlo

Apri un terminale in questa cartella:

```
testamento nasce "Caldo 3000"          nuovo dispositivo: firmware v1.0, bootloader BLOCCATO, capsula #1
testamento aggiorna 1.1                il produttore rilascia un aggiornamento: la ROM ruota il codice
testamento tempo 6                     fa passare 6 mesi (simulati)
testamento stato                       firmware, bootloader, capsule e conto alla rovescia
testamento apri 3                      apre la capsula #3 facendo davvero le T quadrature
testamento sblocca 7F3A-19C2-...       prova un codice di liberazione
testamento installa "FirmwareLibero"   installa un firmware (solo a bootloader sbloccato)
testamento indovina 3                  3 secondi di forza bruta vera, per vedere quanto è inutile
testamento taratura                    rimisura la velocità di questo PC
```

Ogni comando accetta `--dispositivo <cartella>` (oppure `-Dispositivo`). Se lo ometti vale la variabile d'ambiente `TESTAMENTO_DISPOSITIVO`, altrimenti la cartella `.\dispositivo`.

I codici di uscita sono: `0` riuscito, `1` errore d'uso, `2` rifiutato (codice scaduto o falso, installazione negata, capsula ancora sigillata), `3` capsula manomessa.

La prima volta `testamento.cmd` compila da solo `bin\testamento.exe`. Per ricompilare dopo una modifica ai sorgenti usa `build.cmd`.

## Come funziona

### 1. Un codice che non conosce nessuno

Alla nascita la ROM di avvio genera un **codice di liberazione** di 128 bit con il generatore casuale del chip, per esempio `6483-2B19-AD04-69AB-4156-64DF-FE5B-3B5E`. Del codice conserva solo l'**impronta salata**, cioè `SHA-256(sale || codice)`. Il codice vero non viene scritto da nessuna parte e non passa mai dal produttore: esiste soltanto dentro la capsula.

### 2. Ogni aggiornamento fa scadere il codice

A ogni cambio di firmware ufficiale è **la ROM**, e non il produttore, a generare un nuovo codice e a chiuderlo in una nuova capsula. Il codice precedente scade subito. La ROM ne tiene l'impronta, così se qualcuno lo usa può rispondere con precisione: *«codice scaduto: il dispositivo è stato aggiornato dopo quella capsula (v1.0 → v1.2)»*.

Ogni capsula si apre 18 mesi dopo la sua creazione. Ne segue che:

- **finché arrivano aggiornamenti**, ogni capsula che si apre contiene un codice già scaduto;
- **se gli aggiornamenti si fermano**, l'ultima capsula si apre mentre il suo codice è ancora valido, e quel codice sblocca il bootloader.

### 3. La capsula a tempo: il puzzle di Rivest, Shamir e Wagner (1996)

```
p, q        due primi casuali da 512 bit (Miller-Rabin, 40 giri)
N = p·q     1024 bit                         a = casuale, coprimo con N
T           quadrature per 18 mesi di calcolo
b = a^(2^T) mod N

chi conosce φ(N) = (p-1)(q-1):   e = 2^T mod φ(N),   b = a^e mod N        → pochi millisecondi
chi non lo conosce:              x ← x² mod N, ripetuto T volte di fila   → 18 mesi

K = SHA-256(b)  →  due chiavi derivate  →  AES-256-CBC sul codice + HMAC-SHA256 su tutto
```

La ROM, che conosce p e q, sigilla la capsula in un attimo e poi **dimentica p, q e φ(N)**. Da quel momento nemmeno il dispositivo può aprirla in fretta.

La capsula è pubblica (`capsule\capsula-N.json`) e contiene N, a, T, l'IV, il codice cifrato e l'HMAC. Chiunque può conservarne una copia.

### 4. Perché non si può barare

- **Indovinare il codice.** Le combinazioni sono 2^128 = 340.282.366.920.938.463.463.374.607.431.768.211.456. Provandone mille miliardi al secondo servirebbero in media 5,4 × 10^18 anni. `testamento indovina` lo misura sul tuo PC: su quello del prototipo fa circa 760.000 tentativi al secondo, cioè 7 × 10^24 anni.
- **Accelerare l'apertura.** Ogni quadratura ha bisogno del risultato della precedente, quindi mille computer non vanno più veloci di uno. L'unica scorciatoia è conoscere φ(N), cioè fattorizzare N.
- **Il produttore.** Non conosce il codice e non può impedire alla ROM di generarlo. Può solo rimandare la liberazione continuando ad aggiornare, che è proprio ciò che il sistema vuole.
- **Manomettere la capsula.** L'HMAC copre l'intestazione (numero, dispositivo, firmware, N, a, T), l'IV e il testo cifrato. Una capsula alterata viene rifiutata come «CAPSULA MANOMESSA» e il suo contenuto non viene mostrato.
- **Il dispositivo non ha bisogno di un orologio affidabile.** Non conta i mesi da solo: il tempo lo misura il calcolo necessario per aprire la capsula. Spostare l'orologio del termostato non serve a niente.

### 5. Il tempo nel simulatore

Un anno e mezzo di calcolo non entra in una demo, quindi il simulatore comprime il tempo:

- **Taratura.** Alla prima esecuzione il programma misura per 1,5 secondi quante quadrature al secondo fa questo PC e salva il risultato in `bin\taratura.json`. Sul PC del prototipo (Intel i5-1145G7) sono circa **93.500 al secondo** con N da 1024 bit quando è collegato alla corrente, ma a batteria, con la frequenza ridotta a 1,5 GHz, sono meno della metà. Per questo ogni `nasce` fa una prova di 0,3 secondi: se la velocità si discosta di più del 30% dalla taratura salvata, la rimisura. Una capsula già creata, però, tiene il suo T: se il PC rallenta dopo, la capsula si apre più lentamente.
- **1 mese simulato = 0,6 s di calcolo.** Quindi T = 18 × 56.100 = **1.009.800 quadrature**, e una capsula si apre in circa **11 secondi**, con barra di avanzamento.
- **Calendario.** `tempo` sposta il calendario simulato. `apri` esegue solo le quadrature che «ci stanno» nei mesi passati dalla pubblicazione della capsula, come se qualcuno avesse cominciato a calcolare appena è uscita. Se apri una capsula troppo presto, il calcolo si ferma a metà e viene salvato in `capsula-N.lavoro.json`. Un puzzle RSW si può infatti interrompere e riprendere: basta ricordare x e il numero di quadrature già fatte.

## Com'è fatto il dispositivo

```
dispositivo\
  dispositivo.json                 firmware, bootloader, calendario simulato e il registro della ROM
                                   (sali e impronte dei codici, mai i codici)
  capsule\capsula-N.json           la capsula pubblica: N, a, T, IV, codice cifrato, HMAC
  capsule\capsula-N.lavoro.json    il calcolo fatto finora: quadrature eseguite e x corrente
  capsule\capsula-N.codice.txt     il codice, scritto qui quando qualcuno apre la capsula
  certificato-di-liberazione.txt
```

## Nella versione vera

- **Una data del calendario invece di un calcolo.** RSW è un vero primitivo di time-lock, ma dipende dalla velocità di chi calcola: un computer più veloce, o un circuito dedicato, apre la capsula prima. Nella versione vera si userebbe un faro pubblico di casualità come **drand**, con la cifratura **tlock**. La capsula viene cifrata verso un «round» futuro del faro, per esempio quello di una data 18 mesi più avanti, e la chiave per aprirla è la firma a soglia che la rete di drand pubblica proprio in quel momento. In questo modo l'apertura dipende dal calendario e non dalla potenza di calcolo. Il prezzo è dipendere da una rete esterna che deve continuare a esistere e in cui nessun gruppo di nodi oltre la soglia deve accordarsi per pubblicare in anticipo. Si potrebbero anche usare entrambi i meccanismi: tlock per la data e RSW come riserva.
- **ROM e fusibili veri.** Il codice di verifica starebbe nella ROM di avvio (mask ROM), le impronte in memoria OTP o in eFuse, e la liberazione brucerebbe un fusibile. Nessun firmware potrebbe toccare niente di tutto questo.
- **Moduli più grandi.** N da 2048 o 3072 bit invece di 1024.
- **Capsule distribuite con l'aggiornamento.** Il file viaggerebbe insieme al firmware e chiunque potrebbe conservarne una copia.

## Limiti del prototipo

- **La ROM è simulata.** Il suo registro sta in `dispositivo.json`, un file che chiunque può modificare (per esempio scrivendo `"Liberato": true`). La crittografia è vera, ma l'immutabilità della ROM qui è solo dichiarata.
- **Il limite dei 18 mesi lo impone il simulatore.** La garanzia crittografica è che senza le T quadrature il codice non si legge. Però su questo PC le T quadrature durano 11 secondi e non 18 mesi, perché il tempo è compresso di circa 4 milioni di volte. Una capsula vera per questo PC richiederebbe circa 4.400 miliardi di quadrature.
- **RSW dipende dalla velocità.** `BigInteger` di .NET è lento. Una libreria ottimizzata o un circuito dedicato fanno molte più quadrature al secondo, quindi aprirebbero le capsule molto prima. Per questo, in un sistema reale, T andrebbe scelto con un ampio margine, oppure si userebbe tlock.
- **La firma del produttore è simulata.** `aggiorna` non verifica nessuna firma vera.
- **Aggiornamenti fantasma.** Un produttore potrebbe pubblicare all'infinito aggiornamenti vuoti solo per rimandare la liberazione. Testamento protegge dall'abbandono, non dalla malafede.
- **Chi non aggiorna si libera prima.** La ROM ruota il codice solo quando un aggiornamento viene installato. Un proprietario che rifiuta gli aggiornamenti per 18 mesi può quindi liberare il dispositivo, ma per farlo deve restare 18 mesi senza correzioni di sicurezza. È una scelta di progetto da discutere.
- **Nessun limite ai tentativi di `sblocca`.** Con 2^128 codici possibili non serve, ma un dispositivo vero lo metterebbe comunque.
- **Smart App Control.** Su questo PC Smart App Control è attivo, e `bin\testamento.exe` è un eseguibile appena compilato e non firmato. Durante lo sviluppo una delle compilazioni è stata bloccata («Un criterio di controllo dell'applicazione ha bloccato il file»), mentre le altre sono state accettate. Se succede, basta rilanciare `build.cmd`: ogni compilazione produce un file diverso, che viene valutato da capo.
- **Memoria.** I `BigInteger` di .NET sono immutabili, quindi p, q e φ(N) non si possono azzerare in memoria: il programma si limita a non tenerne più riferimenti. Una ROM vera cancellerebbe i registri.

## Test

Fai doppio clic su **`test.cmd`** (circa 7 secondi). Ogni verifica stampa OK o FALLITO, e lo script esce con 1 se qualcosa fallisce. I test controllano:

- Miller-Rabin su numeri noti, compreso il numero di Carmichael 561;
- che il ramo veloce (con φ) e il ramo lento (T quadrature) diano lo stesso b, per diversi valori di T;
- che un calcolo interrotto e poi ripreso dia lo stesso risultato di uno fatto tutto di seguito;
- che la capsula restituisca il codice giusto;
- che l'HMAC rilevi una capsula manomessa: un byte del testo cifrato, l'HMAC stesso, l'intestazione, una quadratura in meno;
- dalla riga di comando: capsula ancora sigillata prima del tempo, codice scaduto e codice falso rifiutati, `installa` rifiutato a bootloader bloccato, capsula alterata sul disco, nessun codice in chiaro nei file del dispositivo, liberazione completa.

I test da riga di comando usano T piccoli: la variabile `TESTAMENTO_QUADRATURE_AL_MESE` imposta direttamente quante quadrature vale un mese.

## File

```
testamento.cmd      avvia il programma (lo compila se manca)
build.cmd           compila src\*.cs in bin\testamento.exe
demo.cmd            la demo narrata (src\demo.ps1)
test.cmd            i test (src\test.ps1)
src\Crittografia.cs primi, puzzle RSW, AES + HMAC, capsula, codice
src\Dispositivo.cs  stato, ROM di avvio, archivio su disco
src\Programma.cs    i comandi e il racconto a schermo
demo\caldo-3000\    i file di una demo vera (li rileggono i test della versione Mac)
mac\                la versione per Mac (Node.js) con il cruscotto web
```

`bin\` non è nel repository: `bin\testamento.exe` e `bin\taratura.json` si creano da soli alla prima esecuzione.

## Su Mac

La cartella `mac` contiene la stessa versione rifatta in Node.js, senza dipendenze, più un cruscotto web: fai doppio clic su **`mac/avvia.command`** (oppure, in un terminale nella cartella `mac`, `npm start`) e il browser si apre su `http://localhost:5177`. La riga di comando è `node mac/bin/testamento.mjs`, con gli stessi comandi e gli stessi file di questa versione. Tutti i dettagli sono in [`mac/README.md`](mac/README.md).

## Licenza

Licenza: da definire (per ora tutti i diritti riservati).
