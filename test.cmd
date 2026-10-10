@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0src\test.ps1"
exit /b %errorlevel%
