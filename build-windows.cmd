@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\build-windows.ps1
pause
