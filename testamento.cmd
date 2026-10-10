@echo off
if not exist "%~dp0bin\testamento.exe" (
    call "%~dp0build.cmd"
    if errorlevel 1 exit /b 1
)
"%~dp0bin\testamento.exe" %*
exit /b %errorlevel%
