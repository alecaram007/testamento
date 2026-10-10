@echo off
rem Compila src\*.cs in bin\testamento.exe con il compilatore C# incluso in .NET Framework 4.8.
setlocal
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
    echo   Non trovo csc.exe di .NET Framework 4.x: impossibile compilare.
    exit /b 1
)
if not exist "%~dp0bin" mkdir "%~dp0bin"
"%CSC%" /nologo /codepage:65001 /optimize+ /target:exe /out:"%~dp0bin\testamento.exe" /r:System.Core.dll /r:System.Numerics.dll /r:System.Web.Extensions.dll "%~dp0src\*.cs"
if errorlevel 1 (
    echo   Compilazione fallita.
    exit /b 1
)
echo   Compilato: bin\testamento.exe
exit /b 0
