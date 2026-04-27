@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0build_windows_bundle.ps1"
