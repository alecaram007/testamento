<#
    Test di Testamento.
    1) Crittografia (caricando bin\testamento.exe come libreria): primi, puzzle RSW
       (ramo veloce con φ contro ramo lento con T quadrature), capsula, HMAC.
    2) Riga di comando, su un dispositivo di prova con T piccoli: codice scaduto,
       codice falso, installazione a bootloader bloccato, capsula manomessa,
       liberazione completa.
    Stampa OK/FALLITO per ogni verifica ed esce con 1 se qualcosa fallisce.
#>
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

$radice = Split-Path -Parent $PSScriptRoot
$exe    = Join-Path $radice 'bin\testamento.exe'
$build  = Join-Path $radice 'build.cmd'

# Ricompila se l'eseguibile manca o è più vecchio dei sorgenti.
$sorgenti = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cs'
$vecchio = -not (Test-Path -LiteralPath $exe)
if (-not $vecchio) {
    $dataExe = (Get-Item -LiteralPath $exe).LastWriteTimeUtc
    foreach ($f in $sorgenti) { if ($f.LastWriteTimeUtc -gt $dataExe) { $vecchio = $true } }
}
if ($vecchio) {
    & cmd.exe /c "`"$build`""
    if ($LASTEXITCODE -ne 0) { Write-Host '  FALLITO   compilazione' -ForegroundColor Red; exit 1 }
}

$prove     = Join-Path $radice 'prove-test'
$marcatore = Join-Path $prove '.test-testamento'
if (Test-Path -LiteralPath $prove) {
    if (-not (Test-Path -LiteralPath $marcatore)) { Write-Host "  La cartella '$prove' esiste ma non l'ha creata il test: non la tocco." -ForegroundColor Red; exit 1 }
    Remove-Item -LiteralPath $prove -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $prove | Out-Null
Set-Content -LiteralPath $marcatore -Value 'Cartella generata da test.ps1: viene ricreata a ogni esecuzione.'

$script:ok = 0
$script:falliti = 0
function Verifica([string]$descrizione, [bool]$esito, [string]$dettaglio = '') {
    if ($esito) {
        $script:ok++
        Write-Host "  OK        $descrizione" -ForegroundColor Green
    } else {
        $script:falliti++
        $extra = ''
        if ($dettaglio) { $extra = "  ($dettaglio)" }
        Write-Host "  FALLITO   $descrizione$extra" -ForegroundColor Red
    }
}
function Titolo([string]$testo) {
    Write-Host ''
    Write-Host "━━━ $testo" -ForegroundColor Magenta
}
# Esegue lo scriptblock e dice se ha lanciato un'eccezione del tipo indicato (anche annidata).
function Test-Lancia([scriptblock]$blocco, [string]$tipo) {
    try { & $blocco | Out-Null; return $false }
    catch {
        $e = $_.Exception
        while ($e) { if ($e.GetType().Name -eq $tipo) { return $true }; $e = $e.InnerException }
        return $false
    }
}
function Uguali([byte[]]$a, [byte[]]$b) { return [Convert]::ToBase64String($a) -eq [Convert]::ToBase64String($b) }

$inizio = [Diagnostics.Stopwatch]::StartNew()

# ---------------------------------------------------------------------------
Titolo '1 · Crittografia'
# ---------------------------------------------------------------------------
Add-Type -AssemblyName System.Numerics
$asm       = [Reflection.Assembly]::LoadFile($exe)
$TipoPrimi     = $asm.GetType('Testamento.Primi')
$TipoPuzzle = $asm.GetType('Testamento.PuzzleRsw')
$TipoCapsula   = $asm.GetType('Testamento.Capsula')
$TipoCodice    = $asm.GetType('Testamento.Codice')
$TipoHex       = $asm.GetType('Testamento.Hex')
$rng       = [Security.Cryptography.RandomNumberGenerator]::Create()
$BI        = [System.Numerics.BigInteger]

# Miller-Rabin su numeri noti
$m127 = $BI::Subtract($BI::Pow(2, 127), 1)                       # primo di Mersenne
$carmichael = New-Object System.Numerics.BigInteger 561          # 3·11·17, inganna Fermat
$composto = $BI::Multiply($m127, $BI::Subtract($BI::Pow(2, 61), 1))
Verifica 'Miller-Rabin: 2^127-1 è primo, 561 e (2^127-1)(2^61-1) no' (
    ($TipoPrimi::ProbabilmentePrimo($m127, $rng, 40)) -and
    -not ($TipoPrimi::ProbabilmentePrimo($carmichael, $rng, 40)) -and
    -not ($TipoPrimi::ProbabilmentePrimo($composto, $rng, 40)))

# Puzzle vero con primi da 512 bit
$t0 = [Diagnostics.Stopwatch]::StartNew()
$z = $TipoPuzzle::Nuovo($rng, 512, 20000)
$msPuzzle = $t0.ElapsedMilliseconds
Verifica "N ha 1024 bit (p, q da 512 bit generati in $msPuzzle ms)" ($TipoHex::LunghezzaByte($z.N) -eq 128)
Verifica 'p·q: φ(N) coerente (a^φ ≡ 1 mod N)' ($BI::ModPow($z.A, $z.Phi, $z.N).IsOne)

foreach ($T in 1, 2, 1000, 20000) {
    $z.T = $T
    $veloce = $z.RisolviConSegreto()
    $t0.Restart()
    $lento = $TipoPuzzle::RisolviLento($z.A, [long]$T, $z.N)
    $ms = $t0.ElapsedMilliseconds
    Verifica "ramo veloce (con φ) = ramo lento, T = $T ($ms ms)" ($veloce.Equals($lento) -and -not $lento.Equals($z.A))
}

# Il lavoro si può interrompere e riprendere
$meta   = $TipoPuzzle::Quadrature($z.A, [long]7000, $z.N, [long]1000, $null)
$ripreso = $TipoPuzzle::Quadrature($meta, [long]13000, $z.N, [long]1000, $null)
Verifica 'calcolo interrotto a 7.000 e ripreso fino a 20.000 = calcolo tutto d''un fiato' ($ripreso.Equals($lento))

# Capsula: sigilla con il ramo veloce, apre con il ramo lento
$codice = $TipoCodice::Nuovo($rng)
$c = $TipoCapsula::Sigilla($z, $codice, 1, 'Prova', 'v1.0', 0, 18)
$b = $TipoPuzzle::RisolviLento($c.BaseA(), $c.T, $c.ModuloN())
$aperto = $c.Apri($b)
Verifica 'la capsula restituisce il codice giusto' (Uguali $aperto $codice)
Verifica 'nella capsula pubblica il codice non compare in chiaro' (-not ((($c.N + $c.A + $c.Iv + $c.Cifrato + $c.Hmac)).Contains($TipoHex::DaByte($codice))))

$z.Dimentica()
Verifica 'dopo Dimentica() il ramo veloce non è più possibile' (Test-Lancia { $z.RisolviConSegreto() } 'InvalidOperationException')

function Altera([string]$h) {
    $primo = $h.Substring(0, 1)
    $nuovo = if ($primo -eq '0') { '1' } else { '0' }
    return $nuovo + $h.Substring(1)
}
$orig = $c.Cifrato; $c.Cifrato = Altera $orig
Verifica 'capsula manomessa (un byte del cifrato cambiato): HMAC la rileva' (Test-Lancia { $c.Apri($b) } 'CapsulaManomessaException')
$c.Cifrato = $orig
$orig = $c.Hmac; $c.Hmac = Altera $orig
Verifica 'capsula manomessa (HMAC cambiato): rilevata' (Test-Lancia { $c.Apri($b) } 'CapsulaManomessaException')
$c.Hmac = $orig
$orig = $c.Firmware; $c.Firmware = 'v9.9'
Verifica 'capsula manomessa (intestazione: firmware cambiato): rilevata' (Test-Lancia { $c.Apri($b) } 'CapsulaManomessaException')
$c.Firmware = $orig
$bSbagliato = $TipoPuzzle::RisolviLento($c.BaseA(), [long]($c.T - 1), $c.ModuloN())
Verifica 'una quadratura in meno (T-1): chiave sbagliata, HMAC la rileva' (Test-Lancia { $c.Apri($bSbagliato) } 'CapsulaManomessaException')
Verifica 'capsula integra: si apre ancora' (Uguali ($c.Apri($b)) $codice)

$testo = $TipoCodice::Formatta($codice)
$riletto = $null
$letto = $TipoCodice::ProvaALeggere($testo.ToLower().Replace('-', ' '), [ref]$riletto)
Verifica "formato del codice ($testo) e rilettura" ($letto -and ($testo -match '^([0-9A-F]{4}-){7}[0-9A-F]{4}$') -and (Uguali $riletto $codice))
$x = $null
Verifica 'rilettura rifiuta testo non esadecimale e codici corti' (-not $TipoCodice::ProvaALeggere('ciao', [ref]$x) -and -not $TipoCodice::ProvaALeggere($testo.Substring(0, 38), [ref]$x))

# ---------------------------------------------------------------------------
Titolo '2 · Riga di comando (T piccoli: 1 mese = 50 quadrature)'
# ---------------------------------------------------------------------------
$env:TESTAMENTO_QUADRATURE_AL_MESE = '50'
$disp = Join-Path $prove 'termostato'
function T {
    $out = & $exe @args --dispositivo $disp | Out-String
    $script:codiceUscita = $LASTEXITCODE
    return $out
}
function Leggi-Stato { return [IO.File]::ReadAllText((Join-Path $disp 'dispositivo.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json }
function Codice-Pubblicato([int]$n) {
    $f = Join-Path $disp "capsule\capsula-$n.codice.txt"
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    $m = [regex]::Match([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8), '([0-9A-F]{4}-){7}[0-9A-F]{4}')
    if ($m.Success) { return $m.Value }
    return $null
}

$o = T nasce 'Termostato di prova'
$s = Leggi-Stato
Verifica 'nasce: firmware v1.0, bootloader BLOCCATO, capsula #1' ($codiceUscita -eq 0 -and $s.Firmware -eq 'v1.0' -and $s.Bootloader -eq 'BLOCCATO' -and (Test-Path (Join-Path $disp 'capsule\capsula-1.json'))) $o
$o = T nasce 'Un altro'
Verifica 'nasce due volte nella stessa cartella: errore' ($codiceUscita -eq 1)

$o = T installa 'FirmwareLibero 1.0'
$s = Leggi-Stato
Verifica 'installa a bootloader bloccato: rifiutato' ($codiceUscita -eq 2 -and $o -match 'rifiutata' -and $s.Firmware -eq 'v1.0') $o

$o = T tempo 5
$o = T apri 1
Verifica 'apri al mese 5: capsula ancora sigillata, nessun codice' ($codiceUscita -eq 2 -and $o -match 'Ancora sigillata' -and -not (Codice-Pubblicato 1)) $o
$o = T stato
Verifica 'stato mostra il calcolo parziale salvato' ($o -match 'calcolo al 27%') $o

$o = T tempo 13
$o = T apri 1
$c1 = Codice-Pubblicato 1
Verifica 'apri al mese 18: il calcolo riprende e la capsula #1 si apre' ($codiceUscita -eq 0 -and $c1 -and $o.Contains($c1)) $o

$o = T aggiorna 1.1
$s = Leggi-Stato
Verifica 'aggiorna 1.1: capsula #2, il codice #1 scade' ($codiceUscita -eq 0 -and $s.Rom.CodiceInVigore -eq 2 -and $s.Rom.Codici[0].MeseScadenza -eq 18 -and (Test-Path (Join-Path $disp 'capsule\capsula-2.json'))) $o

$o = T sblocca $c1
$s = Leggi-Stato
Verifica 'codice scaduto rifiutato: "(v1.0 → v1.1)", bootloader ancora bloccato' ($codiceUscita -eq 2 -and $o.Contains('Codice scaduto') -and $o.Contains('(v1.0 → v1.1)') -and $s.Bootloader -eq 'BLOCCATO') $o

$falso = '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF'
if ($c1 -eq $falso) { $falso = 'FEDC-BA98-7654-3210-FEDC-BA98-7654-3210' }
$o = T sblocca $falso
$s = Leggi-Stato
Verifica 'codice falso rifiutato (e spiegazione dei 2^128 tentativi)' ($codiceUscita -eq 2 -and $o -match 'Codice rifiutato' -and $o -match '2\^128' -and $s.Bootloader -eq 'BLOCCATO') $o
$o = T sblocca 'ciao'
Verifica 'testo che non è un codice: rifiutato' ($codiceUscita -eq 2 -and $o -match 'non è un codice') $o

$o = T aggiorna 1.2
$o = T sblocca $c1
Verifica 'dopo un altro aggiornamento il codice #1 è ancora scaduto: "(v1.0 → v1.2)"' ($codiceUscita -eq 2 -and $o.Contains('(v1.0 → v1.2)')) $o

$tutto = ''
foreach ($f in Get-ChildItem -LiteralPath $disp -Recurse -File) {
    if ($f.Name -notlike '*.codice.txt') { $tutto += [IO.File]::ReadAllText($f.FullName) }
}
Verifica 'nei file del dispositivo il codice #1 non compare in chiaro (solo l''impronta)' (-not $tutto.Contains($c1.Replace('-', '')) -and -not $tutto.Contains($c1))

# Capsula #3 manomessa sul disco
$f3 = Join-Path $disp 'capsule\capsula-3.json'
$originale3 = [IO.File]::ReadAllText($f3, [Text.Encoding]::UTF8)
$j = $originale3 | ConvertFrom-Json
$alterato = $originale3.Replace($j.Cifrato, (Altera $j.Cifrato))
[IO.File]::WriteAllText($f3, $alterato, (New-Object Text.UTF8Encoding $false))
$o = T tempo 18
$o = T apri 3
Verifica 'apri una capsula manomessa sul disco: "CAPSULA MANOMESSA", nessun codice' ($codiceUscita -eq 3 -and $o -match 'CAPSULA MANOMESSA' -and -not (Codice-Pubblicato 3)) $o
[IO.File]::WriteAllText($f3, $originale3, (New-Object Text.UTF8Encoding $false))
$o = T apri 3
$c3 = Codice-Pubblicato 3
Verifica 'capsula #3 ripristinata: si apre (il calcolo salvato era giusto)' ($codiceUscita -eq 0 -and $c3) $o

$o = T sblocca $c3
$s = Leggi-Stato
Verifica 'codice in vigore: bootloader SBLOCCATO e certificato di liberazione' ($codiceUscita -eq 0 -and $s.Bootloader -eq 'SBLOCCATO' -and $s.Rom.Liberato -and (Test-Path (Join-Path $disp 'certificato-di-liberazione.txt')) -and $o -match 'CERTIFICATO DI LIBERAZIONE') $o

$o = T installa 'FirmwareLibero 1.0'
$s = Leggi-Stato
Verifica 'installa a bootloader sbloccato: FirmwareLibero 1.0' ($codiceUscita -eq 0 -and $s.Firmware -eq 'FirmwareLibero 1.0' -and -not $s.FirmwareUfficiale) $o
$o = T stato
Verifica 'stato finale: LIBERO' ($codiceUscita -eq 0 -and $o -match 'Stato\s+LIBERO') $o

Remove-Item Env:\TESTAMENTO_QUADRATURE_AL_MESE

# ---------------------------------------------------------------------------
Write-Host ''
$totale = $script:ok + $script:falliti
$secondi = $inizio.Elapsed.TotalSeconds.ToString('N1', [Globalization.CultureInfo]::GetCultureInfo('it-IT'))
if ($script:falliti -eq 0) {
    Write-Host "  Tutti i $totale test sono OK ($secondi s)." -ForegroundColor Green
    Remove-Item -LiteralPath $prove -Recurse -Force
    exit 0
} else {
    Write-Host "  $($script:falliti) test FALLITI su $totale. La cartella di prova resta in: $prove" -ForegroundColor Red
    exit 1
}
