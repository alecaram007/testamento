<#
    Demo di Testamento: la vita di un termostato, dalla nascita alla liberazione.
    Il produttore lo aggiorna per un anno, poi fallisce. Diciotto mesi dopo
    l'ultimo aggiornamento, la sua ultima capsula si apre e il termostato
    diventa libero, senza che nessuno debba chiedere il permesso.
    Tutto avviene nella cartella "demo" accanto a questo progetto.
#>
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

$radice    = Split-Path -Parent $PSScriptRoot
$exe       = Join-Path $radice 'bin\testamento.exe'
$demo      = Join-Path $radice 'demo'
$marcatore = Join-Path $demo '.demo-testamento'
$caldo     = Join-Path $demo 'caldo-3000'
$IT        = [Globalization.CultureInfo]::GetCultureInfo('it-IT')

if (-not (Test-Path -LiteralPath $exe)) {
    & cmd.exe /c "`"$(Join-Path $radice 'build.cmd')`""
    if ($LASTEXITCODE -ne 0) { throw 'Compilazione fallita: la demo non può partire.' }
}

if (Test-Path -LiteralPath $demo) {
    if (-not (Test-Path -LiteralPath $marcatore)) { throw "La cartella '$demo' esiste ma non l'ha creata la demo: non la tocco." }
    Remove-Item -LiteralPath $demo -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $demo | Out-Null
Set-Content -LiteralPath $marcatore -Value 'Cartella generata da demo.ps1: viene ricreata a ogni esecuzione.'
if (Test-Path Env:\TESTAMENTO_QUADRATURE_AL_MESE) { Remove-Item Env:\TESTAMENTO_QUADRATURE_AL_MESE }

function Virgolette([string]$a) {
    if ($a -eq '' -or $a -match '[\s"]') { return '"' + ($a -replace '"', '\"') + '"' }
    return $a
}

# Esegue testamento.exe senza catturarne l'output, così la barra di avanzamento
# si aggiorna dal vivo. $Attesi sono i codici di uscita previsti dalla storia
# (2 = rifiutato: codice scaduto o falso, installazione negata, capsula sigillata).
function Testamento {
    [CmdletBinding(PositionalBinding = $false)]
    param([int[]]$Attesi = @(0), [Parameter(ValueFromRemainingArguments = $true)][string[]]$Argomenti)
    Write-Host ''
    Write-Host ('  > testamento ' + (($Argomenti | ForEach-Object { Virgolette $_ }) -join ' ')) -ForegroundColor DarkGray
    $riga = (@($Argomenti) + @('--dispositivo', $caldo) | ForEach-Object { Virgolette $_ }) -join ' '
    $psi = New-Object Diagnostics.ProcessStartInfo $exe, $riga
    $psi.UseShellExecute = $false
    $p = [Diagnostics.Process]::Start($psi)
    $p.WaitForExit()
    $uscita = $p.ExitCode
    $p.Dispose()
    if ($Attesi -notcontains $uscita) { throw "'testamento $($Argomenti -join ' ')' è uscito con il codice ${uscita}: la demo si ferma qui." }
}
function Titolo([string]$testo) {
    Write-Host ''
    Write-Host ''
    Write-Host "━━━ $testo" -ForegroundColor Magenta
}
function Racconto([string]$testo) {
    Write-Host "  $testo" -ForegroundColor DarkCyan
}
function Codice-Pubblicato([int]$n) {
    $f = Join-Path $caldo "capsule\capsula-$n.codice.txt"
    $m = [regex]::Match([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8), '([0-9A-F]{4}-){7}[0-9A-F]{4}')
    if (-not $m.Success) { throw "Nessun codice in $f" }
    return $m.Value
}

$orologio = [Diagnostics.Stopwatch]::StartNew()

# ---------------------------------------------------------------------------
# La storia
# ---------------------------------------------------------------------------
Titolo '1 · Nasce il termostato «Caldo 3000», con il firmware v1.0'
Racconto 'Nella ROM di avvio c''è la regola del testamento. Nessun aggiornamento potrà cambiarla.'
Testamento nasce 'Caldo 3000'

Titolo '2 · Mese 6: il produttore rilascia la v1.1'
Testamento tempo 6
Testamento aggiorna 1.1

Titolo '3 · Mese 12: arriva la v1.2'
Testamento tempo 6
Testamento aggiorna 1.2
Testamento stato

Titolo '4 · Un curioso vuole sbloccare il termostato subito. Prima tira a indovinare...'
Testamento -Attesi 2 sblocca '1234-5678-9ABC-DEF0-1234-5678-9ABC-DEF0'
Testamento indovina 2

Titolo '5 · ...poi prova ad aprire la capsula #1, la più vecchia: ha solo 12 mesi'
Testamento -Attesi 2 apri 1

Titolo '6 · Mese 14: il produttore fallisce'
Racconto 'Nessun comando lo annuncia: il termostato non lo sa e non ha bisogno di saperlo.'
Racconto 'Semplicemente, da oggi non arriverà più nessun aggiornamento.'
Testamento tempo 2
Racconto 'Qualcuno prova subito a installare un firmware libero:'
Testamento -Attesi 2 installa 'FirmwareLibero 1.0'

Titolo '7 · Mese 18: la capsula #1 compie 18 mesi e il curioso finisce il calcolo'
Testamento tempo 4
Testamento apri 1
$codice1 = Codice-Pubblicato 1
Testamento -Attesi 2 sblocca $codice1

Titolo '8 · Mese 32: da 20 mesi non arriva niente. La comunità apre la capsula #3'
Testamento tempo 14
Testamento stato
Testamento apri 3
$codice3 = Codice-Pubblicato 3

Titolo '9 · Il codice della capsula #3 è ancora valido: il bootloader si sblocca'
Testamento sblocca $codice3

Titolo '10 · La comunità installa FirmwareLibero 1.0'
Testamento installa 'FirmwareLibero 1.0'
Testamento stato

# ---------------------------------------------------------------------------
Titolo 'Fine'
$totale = $orologio.Elapsed.TotalSeconds
$secondi = @{}
foreach ($n in 1, 3) {
    $w = [IO.File]::ReadAllText((Join-Path $caldo "capsule\capsula-$n.lavoro.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
    $secondi[$n] = [double]$w.Secondi
}
Write-Host '  Il «Caldo 3000» è sopravvissuto al suo produttore.' -ForegroundColor Green
Write-Host ('  Quadrature sequenziali: capsula #1 {0} s (in due riprese), capsula #3 {1} s.' -f $secondi[1].ToString('N1', $IT), $secondi[3].ToString('N1', $IT))
Write-Host ('  Durata totale della demo: {0} s.' -f $totale.ToString('N1', $IT))
Write-Host "  I file del dispositivo sono in:  $caldo"
Write-Host '  (capsule\ con le capsule pubbliche e i codici aperti, certificato-di-liberazione.txt)' -ForegroundColor DarkGray
Write-Host ''
