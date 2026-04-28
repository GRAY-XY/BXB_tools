@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "ROOT=%~dp0..\..\.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

set "PYTHON_BIN=%USERPROFILE%\tools\python-nuget-x64\tools\python.exe"
set "NODE_BIN=%USERPROFILE%\tools\node-v24.15.0-win-x64\node.exe"
set "NPM_BIN=%USERPROFILE%\tools\node-v24.15.0-win-x64\npm.cmd"

if not exist "%PYTHON_BIN%" (
  echo [BXB] Missing x64 Python at:
  echo %PYTHON_BIN%
  exit /b 1
)

if not exist "%NODE_BIN%" (
  echo [BXB] Missing x64 Node at:
  echo %NODE_BIN%
  exit /b 1
)

echo [BXB] x64 Python:
"%PYTHON_BIN%" --version

echo [BXB] x64 Node:
"%NODE_BIN%" -v
call "%NPM_BIN%" -v

set "PYTHON_BIN=%PYTHON_BIN%"
set "NODE_BIN=%NODE_BIN%"
set "NPM_BIN=%NPM_BIN%"

powershell -ExecutionPolicy Bypass -File "%ROOT%\desktop-shell\packaging\windows\build_windows_bundle.ps1"
exit /b %errorlevel%
