$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$FlutterRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\..\"))
$WorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $FlutterRoot "..\..\"))
$AppName = "BXB Student"
$VersionLine = (Select-String -Path (Join-Path $FlutterRoot "pubspec.yaml") -Pattern '^version:\s+(.+)$').Matches[0].Groups[1].Value.Trim()
$Version = $VersionLine.Split('+')[0]
$BuildStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BuildRoot = Join-Path $WorkspaceRoot "build\banxuebang-flutter-windows"
$RuntimeRoot = Join-Path $BuildRoot "runtime"
$NpmRuntimeRoot = Join-Path $BuildRoot "npm-runtime"
$PrereqsRoot = Join-Path $BuildRoot "prereqs"
$DistRoot = Join-Path $WorkspaceRoot "dist\banxuebang-flutter-release-$BuildStamp"
$AppStageRoot = Join-Path $DistRoot $AppName
$FlutterBundleRoot = Join-Path $FlutterRoot "build\windows\x64\runner\Release"
$ZipPath = Join-Path $DistRoot ("BXB_Student_Windows_v{0}.zip" -f $Version)
$InstallerPath = Join-Path $DistRoot ("BXB_Student_Windows_v{0}_Setup.exe" -f $Version)
$IssPath = Join-Path $BuildRoot "BXB_Student.iss"
$LicenseFile = Join-Path $WorkspaceRoot "docs\legal\BXB_Student_User_Agreement_Installer_zh-CN.txt"
$IconIco = Join-Path $WorkspaceRoot "desktop-client\assets\app_icon.ico"
$VcRedistUrl = "https://aka.ms/vc14/vc_redist.x64.exe"
$VcRedistPath = Join-Path $PrereqsRoot "vc_redist.x64.exe"

function Resolve-Tool([string]$ToolName, [string]$OverrideVarName = "") {
  if ($OverrideVarName) {
    $override = [Environment]::GetEnvironmentVariable($OverrideVarName)
    if ($override -and (Test-Path $override)) {
      return $override
    }
  }

  $command = Get-Command $ToolName -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Missing required tool: $ToolName"
  }
  return $command.Source
}

function Get-IsccCandidates {
  @(
    (Get-Command iscc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  ) | Where-Object { $_ }
}

function Ensure-InnoSetup {
  foreach ($candidate in (Get-IsccCandidates)) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  Write-Host "[BXB Build] Installing Inno Setup via winget..."
  winget install -e --id JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements --disable-interactivity

  foreach ($candidate in (Get-IsccCandidates)) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Inno Setup installation failed."
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

function Stage-RuntimePayload {
  New-Item -ItemType Directory -Force -Path (Join-Path $AppStageRoot "desktop-shell") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $AppStageRoot "docs") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $AppStageRoot "runtime") | Out-Null

  Copy-Item (Join-Path $WorkspaceRoot "desktop-shell\node_bridge.js") -Destination (Join-Path $AppStageRoot "desktop-shell\node_bridge.js") -Force
  Copy-Item (Join-Path $WorkspaceRoot "src") -Destination (Join-Path $AppStageRoot "src") -Recurse -Force
  Copy-Item (Join-Path $WorkspaceRoot "docs\legal") -Destination (Join-Path $AppStageRoot "docs\legal") -Recurse -Force
  Copy-Item (Join-Path $WorkspaceRoot "package.json") -Destination (Join-Path $AppStageRoot "package.json") -Force
  Copy-Item (Join-Path $WorkspaceRoot "package-lock.json") -Destination (Join-Path $AppStageRoot "package-lock.json") -Force
  Copy-Item (Join-Path $NpmRuntimeRoot "node_modules") -Destination (Join-Path $AppStageRoot "node_modules") -Recurse -Force
  Copy-Item (Join-Path $RuntimeRoot "node.exe") -Destination (Join-Path $AppStageRoot "runtime\node.exe") -Force
  Copy-Item (Join-Path $RuntimeRoot "ms-playwright") -Destination (Join-Path $AppStageRoot "runtime\ms-playwright") -Recurse -Force
}

$flutter = Resolve-Tool "flutter" "FLUTTER_BIN"
$node = Resolve-Tool "node" "NODE_BIN"
$npm = Resolve-Tool "npm" "NPM_BIN"
$iscc = Ensure-InnoSetup

if (-not (Test-Path $LicenseFile)) {
  throw "Installer agreement text not found: $LicenseFile"
}

if (-not (Test-Path $IconIco)) {
  throw "Installer icon not found: $IconIco"
}

if (Test-Path $BuildRoot) {
  Remove-Item $BuildRoot -Recurse -Force
}
if (Test-Path $DistRoot) {
  Remove-Item $DistRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $BuildRoot, $RuntimeRoot, $NpmRuntimeRoot, $PrereqsRoot, $DistRoot, $AppStageRoot | Out-Null

Push-Location $FlutterRoot
& $flutter build windows --release
Pop-Location

if (-not (Test-Path $FlutterBundleRoot)) {
  throw "Built Windows bundle not found: $FlutterBundleRoot"
}

Copy-Item (Join-Path $FlutterBundleRoot "*") -Destination $AppStageRoot -Recurse -Force
Copy-Item $node -Destination (Join-Path $RuntimeRoot "node.exe") -Force
Stage-PlaywrightRuntime (Find-PlaywrightCacheRoot)
Download-RequiredFile -Url $VcRedistUrl -DestinationPath $VcRedistPath

Copy-Item (Join-Path $WorkspaceRoot "package.json") -Destination (Join-Path $NpmRuntimeRoot "package.json") -Force
Copy-Item (Join-Path $WorkspaceRoot "package-lock.json") -Destination (Join-Path $NpmRuntimeRoot "package-lock.json") -Force
Push-Location $NpmRuntimeRoot
& $npm ci --omit=dev
Pop-Location

Stage-RuntimePayload

if (Test-Path $ZipPath) {
  Remove-Item $ZipPath -Force
}
Compress-Archive -Path $AppStageRoot -DestinationPath $ZipPath

@"
#define AppName "$AppName"
#define AppVersion "$Version"
#define AppPublisher "GRAY-XY"
#define AppExeName "BXB Student.exe"
#define SourceDir "$($AppStageRoot -replace '\\', '\\')"
#define LicenseFile "$($LicenseFile -replace '\\', '\\')"
#define OutputDir "$($DistRoot -replace '\\', '\\')"
#define SetupIcon "$($IconIco -replace '\\', '\\')"

[Setup]
AppId={{A3EAB7A2-60F6-4B85-9B16-C5B62EA5A674}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
LicenseFile={#LicenseFile}
OutputDir={#OutputDir}
OutputBaseFilename=BXB_Student_Windows_v${Version}_Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}
SetupIconFile={#SetupIcon}

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "$($VcRedistPath -replace '\\', '\\')"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "安装 Microsoft Visual C++ x64 Runtime..."; Flags: waituntilterminated runhidden
Filename: "{app}\{#AppExeName}"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent
"@ | Set-Content -Path $IssPath -Encoding UTF8

& $iscc $IssPath | Out-Host

if (-not (Test-Path $InstallerPath)) {
  throw "Installer build finished but expected output was not found: $InstallerPath"
}

Write-Host "[BXB Build] App bundle staged at $AppStageRoot"
Write-Host "[BXB Build] ZIP created at $ZipPath"
Write-Host "[BXB Build] Installer created at $InstallerPath"
