$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptRoot)
$OutputDir = Join-Path $ProjectRoot "dist\windows-installer"
$PythonExe = $null
foreach ($candidate in @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
    "py -3.12",
    "python",
    "python3"
)) {
    try {
        if ($candidate -eq "py -3.12") {
            $resolved = (& py -3.12 -c "import sys; print(sys.executable)" | Select-Object -First 1).Trim()
            if ($resolved) {
                $PythonExe = $resolved
                break
            }
        } elseif (Get-Command $candidate -ErrorAction SilentlyContinue) {
            $PythonExe = (Get-Command $candidate).Source
            break
        } elseif (Test-Path $candidate) {
            $PythonExe = $candidate
            break
        }
    } catch {
    }
}

if (-not $PythonExe) {
    throw "Python 3.12+ is required to build the Windows installer."
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
& $PythonExe (Join-Path $ProjectRoot "generate_ui_assets.py")
if ($LASTEXITCODE -ne 0) {
    throw "UI asset generation failed."
}
& (Join-Path $ScriptRoot "prepare_windows_runtime.ps1") -ProjectRoot $ProjectRoot -PythonExe $PythonExe
if ($LASTEXITCODE -ne 0) {
    throw "Bundled runtime preparation failed."
}
$iscc = Ensure-InnoSetup
$appVersion = (& $PythonExe -c "from app_metadata import APP_VERSION; print(APP_VERSION)" | Select-Object -First 1).Trim()
Write-Host "[BXB Build] Using ISCC: $iscc"
Write-Host "[BXB Build] Building version: $appVersion"
& $iscc "/DMyAppVersion=$appVersion" (Join-Path $ScriptRoot "bxb_installer.iss")
if ($LASTEXITCODE -ne 0) {
    throw "ISCC failed with exit code $LASTEXITCODE"
}

Write-Host "[BXB Build] Installer created in $OutputDir"
