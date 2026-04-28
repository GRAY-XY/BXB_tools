$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\..\.."))
$AppName = "BXB Student"
$BundleName = "BXBStudent"
$BuildRoot = Join-Path $ProjectRoot "build\desktop-shell-windows"
$RuntimeRoot = Join-Path $BuildRoot "runtime"
$NpmRuntimeRoot = Join-Path $BuildRoot "npm-runtime"
$PrereqsRoot = Join-Path $BuildRoot "prereqs"
$SpecRoot = Join-Path $BuildRoot "spec"
$PyInstallerRoot = Join-Path $BuildRoot "pyinstaller"
$Version = (Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json).version
$BuildStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$DistRoot = Join-Path $ProjectRoot "dist\desktop-shell-windows-$BuildStamp"
$AppDir = Join-Path $DistRoot $AppName
$ExePath = Join-Path $AppDir "BXB Student.exe"
$ZipPath = Join-Path $DistRoot ("BXB_Student_Windows_v{0}.zip" -f $Version)
$InstallerPath = Join-Path $DistRoot ("BXB_Student_Windows_v{0}_Setup.exe" -f $Version)
$IconPng = Join-Path $ProjectRoot "desktop-shell\assets\app-icon.png"
$IconIco = Join-Path $ProjectRoot "desktop-shell\assets\app-icon.ico"
$LicenseFile = Join-Path $ProjectRoot "docs\legal\BXB_Student_User_Agreement_Installer_zh-CN.txt"
$WebView2InstallerUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
$VcRedistUrl = "https://aka.ms/vc14/vc_redist.x64.exe"
$WebView2InstallerPath = Join-Path $PrereqsRoot "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
$VcRedistPath = Join-Path $PrereqsRoot "vc_redist.x64.exe"

function Resolve-Tool([string]$ToolName) {
  $overrideMap = @{
    "python" = $env:PYTHON_BIN
    "node" = $env:NODE_BIN
    "npm" = $env:NPM_BIN
  }
  $override = $overrideMap[$ToolName]
  if ($override -and (Test-Path $override)) {
    return $override
  }
  $command = Get-Command $ToolName -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Missing required tool: $ToolName"
  }
  return $command.Source
}

function Ensure-AppIcon {
  if (Test-Path $IconIco) {
    return
  }

  $pythonForIcon = Resolve-Tool "python"
  & $pythonForIcon -c @"
from pathlib import Path
from PIL import Image

source = Path(r"$IconPng")
target = Path(r"$IconIco")
image = Image.open(source).convert("RGBA")
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
image.save(target, format="ICO", sizes=sizes)
"@
}

function Download-RequiredFile([string]$Url, [string]$DestinationPath) {
  $destinationDir = Split-Path -Parent $DestinationPath
  New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null

  if (Test-Path $DestinationPath) {
    return
  }

  Write-Host "[BXB Build] Downloading prerequisite: $([System.IO.Path]::GetFileName($DestinationPath))"
  Invoke-WebRequest -Uri $Url -OutFile $DestinationPath
}

function Stage-Prerequisites {
  Download-RequiredFile -Url $WebView2InstallerUrl -DestinationPath $WebView2InstallerPath
  Download-RequiredFile -Url $VcRedistUrl -DestinationPath $VcRedistPath
}

function Find-PlaywrightCacheRoot {
  if ($env:PLAYWRIGHT_CACHE_ROOT -and (Test-Path $env:PLAYWRIGHT_CACHE_ROOT)) {
    return $env:PLAYWRIGHT_CACHE_ROOT
  }
  if ($env:PLAYWRIGHT_BROWSERS_PATH -and (Test-Path $env:PLAYWRIGHT_BROWSERS_PATH)) {
    return $env:PLAYWRIGHT_BROWSERS_PATH
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "ms-playwright"),
    (Join-Path $env:USERPROFILE "AppData\Local\ms-playwright")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Playwright browser cache was not found. Run 'npx playwright install chromium' first."
}

function Stage-PlaywrightRuntime([string]$CacheRoot) {
  $stagedRoot = Join-Path $RuntimeRoot "ms-playwright"
  New-Item -ItemType Directory -Force -Path $stagedRoot | Out-Null

  $chromiumDirs = Get-ChildItem $CacheRoot -Directory | Where-Object { $_.Name -like "chromium-*" }
  if (-not $chromiumDirs) {
    throw "No Chromium runtime found inside $CacheRoot"
  }

  foreach ($dir in $chromiumDirs) {
    Copy-Item $dir.FullName -Destination (Join-Path $stagedRoot $dir.Name) -Recurse -Force
  }
}

function Build-Installer([string]$SourceDir, [string]$OutputPath) {
  $iscc = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
  if ($null -eq $iscc) {
    Write-Host "[BXB Build] Inno Setup not found, skipping installer generation."
    return
  }

  $issPath = Join-Path $BuildRoot "BXB_Student.iss"
  @"
#define AppName "$AppName"
#define AppVersion "$Version"
#define AppPublisher "GRAY-XY"
#define AppExeName "BXB Student.exe"
#define SourceDir "$($SourceDir -replace '\\', '\\')"
#define LicenseFile "$($LicenseFile -replace '\\', '\\')"
#define OutputDir "$($DistRoot -replace '\\', '\\')"

[Setup]
AppId={{A3EAB7A2-60F6-4B85-9B16-C5B62EA5A674}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
LicenseFile={#LicenseFile}
OutputDir={#OutputDir}
OutputBaseFilename=BXB_Student_Windows_v$Version`_Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "$($VcRedistPath -replace '\\', '\\')"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "$($WebView2InstallerPath -replace '\\', '\\')"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "安装 Microsoft Visual C++ x64 Runtime..."; Flags: waituntilterminated runhidden
Filename: "{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "安装 Microsoft Edge WebView2 Runtime..."; Flags: waituntilterminated runhidden
Filename: "{app}\{#AppExeName}"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent
"@ | Set-Content -Path $issPath -Encoding UTF8

  & $iscc.Source $issPath | Out-Host
  if (-not (Test-Path $OutputPath)) {
    Write-Host "[BXB Build] Installer build finished but expected output was not found: $OutputPath"
  }
}

function Normalize-AppOutput([string]$SourceDir, [string]$TargetDir) {
  if (Test-Path $TargetDir) {
    Remove-Item $TargetDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  Copy-Item (Join-Path $SourceDir "*") -Destination $TargetDir -Recurse -Force

  $existingExe = Get-ChildItem -LiteralPath $TargetDir -Filter "*.exe" -File | Select-Object -First 1
  if ($null -eq $existingExe) {
    throw "No executable was found in $TargetDir"
  }

  $normalizedExe = Join-Path $TargetDir "BXB Student.exe"
  if ($existingExe.FullName -ne $normalizedExe) {
    if (Test-Path $normalizedExe) {
      Remove-Item $normalizedExe -Force
    }
    Rename-Item -LiteralPath $existingExe.FullName -NewName "BXB Student.exe"
  }
}

$python = Resolve-Tool "python"
$node = Resolve-Tool "node"
$npm = Resolve-Tool "npm"

Ensure-AppIcon

if (Test-Path $BuildRoot) {
  Remove-Item $BuildRoot -Recurse -Force
}
if (Test-Path $DistRoot) {
  Remove-Item $DistRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $BuildRoot, $RuntimeRoot, $NpmRuntimeRoot, $PrereqsRoot, $SpecRoot, $PyInstallerRoot, $DistRoot | Out-Null

Copy-Item $node -Destination (Join-Path $RuntimeRoot "node.exe") -Force
Stage-PlaywrightRuntime (Find-PlaywrightCacheRoot)
Stage-Prerequisites

Copy-Item (Join-Path $ProjectRoot "package.json") -Destination (Join-Path $NpmRuntimeRoot "package.json") -Force
Copy-Item (Join-Path $ProjectRoot "package-lock.json") -Destination (Join-Path $NpmRuntimeRoot "package-lock.json") -Force
Push-Location $NpmRuntimeRoot
& $npm ci --omit=dev
Pop-Location

& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --windowed `
  --name "$BundleName" `
  --icon "$IconIco" `
  --distpath "$DistRoot" `
  --workpath "$PyInstallerRoot" `
  --specpath "$SpecRoot" `
  --hidden-import webview.platforms.edgechromium `
  --hidden-import webview.platforms.winforms `
  --add-data "$ProjectRoot\desktop-shell;desktop-shell" `
  --add-data "$ProjectRoot\config;config" `
  --add-data "$ProjectRoot\docs;docs" `
  --add-data "$ProjectRoot\src;src" `
  --add-data "$ProjectRoot\package.json;." `
  --add-data "$ProjectRoot\package-lock.json;." `
  --add-data "$NpmRuntimeRoot\node_modules;node_modules" `
  --add-data "$RuntimeRoot\ms-playwright;runtime\ms-playwright" `
  --add-binary "$RuntimeRoot\node.exe;runtime" `
  "$ProjectRoot\desktop-shell\app.py"

if ((Test-Path variable:LASTEXITCODE) -and $LASTEXITCODE -ne 0) {
  throw "PyInstaller failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path $AppDir)) {
  $candidate = Get-ChildItem -LiteralPath $DistRoot -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $candidate) {
    $candidate = Get-ChildItem -LiteralPath (Split-Path $DistRoot -Parent) -Directory -ErrorAction SilentlyContinue `
      | Where-Object { $_.FullName -ne $DistRoot } `
      | Where-Object { Test-Path (Join-Path $_.FullName "*.exe") } `
      | Sort-Object LastWriteTime -Descending `
      | Select-Object -First 1
  }
  if ($null -eq $candidate) {
    throw "PyInstaller did not produce an app directory under $DistRoot"
  }
  Normalize-AppOutput -SourceDir $candidate.FullName -TargetDir $AppDir
}

if (-not (Test-Path $ExePath)) {
  $existingExe = Get-ChildItem -LiteralPath $AppDir -Filter "*.exe" -File | Select-Object -First 1
  if ($null -eq $existingExe) {
    throw "No executable was found in $AppDir"
  }
  if ($existingExe.Name -ne "BXB Student.exe") {
    Rename-Item -LiteralPath $existingExe.FullName -NewName "BXB Student.exe"
  }
}

Compress-Archive -Path (Join-Path $AppDir "*") -DestinationPath $ZipPath -Force
Build-Installer -SourceDir $AppDir -OutputPath $InstallerPath

Write-Host "[BXB Build] Windows app created at $ExePath"
Write-Host "[BXB Build] ZIP created at $ZipPath"
if (Test-Path $InstallerPath) {
  Write-Host "[BXB Build] Installer created at $InstallerPath"
}
