Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$buildAssets = Join-Path $repoRoot "build_assets"
$nodeVersion = "22.15.0"
$nodeDist = "node-v$nodeVersion-win-x64"
$nodeZip = Join-Path $buildAssets "$nodeDist.zip"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeDist.zip"
$browserRoot = Join-Path $env:LOCALAPPDATA "ms-playwright"
$browserZip = Join-Path $buildAssets "ms-playwright-browsers.zip"

if (-not (Test-Path $buildAssets)) {
    New-Item -ItemType Directory -Path $buildAssets | Out-Null
}

Write-Host "Installing Python build/runtime dependencies"
python -m pip install --disable-pip-version-check pyinstaller ttkbootstrap tkinterweb markdown-it-py | Out-Host

if (-not (Test-Path $nodeZip)) {
    Write-Host "Downloading bundled Node runtime from $nodeUrl"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
} else {
    Write-Host "Reusing bundled Node runtime archive: $nodeZip"
}

if (Test-Path $browserRoot) {
    if (-not (Test-Path $browserZip)) {
        Write-Host "Packaging local Playwright browser payload from $browserRoot"
        @'
from pathlib import Path
import sys
import zipfile

source_root = Path(sys.argv[1])
target_zip = Path(sys.argv[2])
target_zip.parent.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(target_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(source_root.rglob("*")):
        if path.is_dir():
            continue
        archive.write(path, path.relative_to(source_root))
'@ | python - $browserRoot $browserZip | Out-Host
    } else {
        Write-Host "Reusing bundled Playwright browser archive: $browserZip"
    }
} else {
    Write-Host "Local Playwright browser cache not found. Build will keep first-launch download fallback."
}

Write-Host "Building standalone EXE..."
python -m PyInstaller --noconfirm --clean "$repoRoot\BXB_Homework_UI.spec" | Out-Host

Write-Host "Build completed."
Write-Host "EXE: $repoRoot\dist\BXB_Homework_UI.exe"
