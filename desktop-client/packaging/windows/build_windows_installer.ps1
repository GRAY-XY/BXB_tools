$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptRoot)
$OutputDir = Join-Path $ProjectRoot "dist\windows-installer"
$PythonExe = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"

if (-not (Test-Path $PythonExe)) {
    $PythonExe = "python"
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

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$iscc = Ensure-InnoSetup
$appVersion = (& $PythonExe -c "from app_metadata import APP_VERSION; print(APP_VERSION)" | Select-Object -First 1).Trim()
Write-Host "[BXB Build] Using ISCC: $iscc"
Write-Host "[BXB Build] Building version: $appVersion"
& $iscc "/DMyAppVersion=$appVersion" (Join-Path $ScriptRoot "bxb_installer.iss")
if ($LASTEXITCODE -ne 0) {
    throw "ISCC failed with exit code $LASTEXITCODE"
}

Write-Host "[BXB Build] Installer created in $OutputDir"
