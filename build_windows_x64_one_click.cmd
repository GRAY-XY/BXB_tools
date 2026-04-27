@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title BXB Student x64 One-Click Build

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo.
echo [BXB] x64 一键打包脚本
echo.

for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Get-Content '.\package.json' -Raw | ConvertFrom-Json).version"`) do (
  set "APP_VERSION=%%V"
)
if not defined APP_VERSION set "APP_VERSION=1.0.1"

if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
  echo [BXB] 当前机器是 ARM64，这个脚本是给朋友的 x64 Windows 用的。
  echo [BXB] 继续也能跑，但不会是你要的原生 x64 验证环境。
  echo.
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo [BXB] 缺少 PowerShell，无法继续。
  pause
  exit /b 1
)

set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
if not exist "%WINGET%" (
  echo [BXB] 缺少 winget，请先在这台电脑上启用 App Installer。
  pause
  exit /b 1
)

echo [BXB] 检查并安装 x64 Python / Node / WebView2 ...
call :winget_install "Python.Python.3.12" "Python 3.12 x64" "--architecture x64 --scope user"
call :winget_install "OpenJS.NodeJS.LTS" "Node.js LTS x64" "--architecture x64 --scope user"
call :winget_install "Microsoft.EdgeWebView2Runtime" "WebView2 Runtime" "--scope user"

set "PYTHON_BIN=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not exist "%PYTHON_BIN%" set "PYTHON_BIN=%LOCALAPPDATA%\Programs\Python\Python312-64\python.exe"
if not exist "%PYTHON_BIN%" (
  echo [BXB] 没找到 x64 Python，请检查 Python 是否安装成功。
  pause
  exit /b 1
)

set "NODE_BIN=%LOCALAPPDATA%\Programs\nodejs\node.exe"
set "NPM_BIN=%LOCALAPPDATA%\Programs\nodejs\npm.cmd"
if not exist "%NODE_BIN%" (
  echo [BXB] 没找到 x64 Node.js，请检查 Node.js 是否安装成功。
  pause
  exit /b 1
)

echo [BXB] Python:
"%PYTHON_BIN%" --version
echo [BXB] Node:
"%NODE_BIN%" -v
call "%NPM_BIN%" -v

echo.
echo [BXB] 安装 Python 打包依赖 ...
"%PYTHON_BIN%" -m pip install --upgrade pip pywebview pyinstaller pillow
if errorlevel 1 goto :fail

echo.
echo [BXB] 安装 Node 依赖 ...
call "%NPM_BIN%" install
if errorlevel 1 goto :fail

echo.
echo [BXB] 安装 Playwright Chromium ...
call "%NPM_BIN%" exec playwright install chromium
if errorlevel 1 goto :fail

echo.
echo [BXB] 开始打包 ...
set "PYTHON_BIN=%PYTHON_BIN%"
set "NODE_BIN=%NODE_BIN%"
set "NPM_BIN=%NPM_BIN%"
powershell -ExecutionPolicy Bypass -File ".\desktop-shell\packaging\windows\build_windows_bundle.ps1"
if errorlevel 1 goto :fail

set "LATEST_DIST="
for /f "delims=" %%D in ('dir /b /ad /o-d ".\dist\desktop-shell-windows-*" 2^>nul') do (
  if not defined LATEST_DIST set "LATEST_DIST=%%D"
)

if not defined LATEST_DIST (
  echo [BXB] 没找到打包输出目录。
  goto :fail
)

set "APP_EXE=%CD%\dist\%LATEST_DIST%\BXB Student\BXB Student.exe"
set "APP_ZIP=%CD%\dist\%LATEST_DIST%\BXB_Student_Windows_v%APP_VERSION%.zip"

if not exist "%APP_EXE%" (
  echo [BXB] 没找到可执行文件：
  echo %APP_EXE%
  goto :fail
)

echo.
echo [BXB] 打包完成
echo [BXB] EXE: %APP_EXE%
if exist "%APP_ZIP%" echo [BXB] ZIP: %APP_ZIP%

echo.
echo [BXB] 启动应用做一次本机测试 ...
start "" "%APP_EXE%"
timeout /t 8 /nobreak >nul
tasklist | findstr /i "BXB Student.exe BXBStudent.exe" >nul
if errorlevel 1 (
  echo [BXB] 应用没有保持运行，请检查窗口是否闪退。
  echo [BXB] 你可以把 dist 目录和日志发回来。
) else (
  echo [BXB] 应用已启动，说明这台 x64 机器上的基础打包/启动链路已经通了。
)

echo.
echo [BXB] 打包目录已打开。
start "" explorer "%CD%\dist\%LATEST_DIST%"
pause
exit /b 0

:winget_install
set "PKG_ID=%~1"
set "PKG_NAME=%~2"
set "PKG_ARGS=%~3"
echo [BXB] 安装/校验 %PKG_NAME% ...
"%WINGET%" install --id %PKG_ID% %PKG_ARGS% --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 (
  echo [BXB] %PKG_NAME% 安装可能失败，继续尝试使用本机已有版本。
)
exit /b 0

:fail
echo.
echo [BXB] 过程中出现错误，请把当前窗口截图或者把终端输出发给我。
pause
exit /b 1
