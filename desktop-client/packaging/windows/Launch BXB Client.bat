@echo off
setlocal
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0start_gui.ps1"
endlocal
