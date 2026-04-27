Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$buildAssets = Join-Path $repoRoot "build_assets"
$nodeVersion = "22.15.0"
$nodeDist = "node-v$nodeVersion-win-x64"
$nodeZip = Join-Path $buildAssets "$nodeDist.zip"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeDist.zip"

if (-not (Test-Path $buildAssets)) {
    New-Item -ItemType Directory -Path $buildAssets | Out-Null
}

Write-Host "Installing build dependency: PyInstaller"
python -m pip install --disable-pip-version-check pyinstaller | Out-Host

if (-not (Test-Path $nodeZip)) {
    Write-Host "Downloading bundled Node runtime from $nodeUrl"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
} else {
    Write-Host "Reusing bundled Node runtime archive: $nodeZip"
}

Write-Host "Building standalone EXE..."
python -m PyInstaller --noconfirm --clean "$repoRoot\BXB_Homework_UI.spec" | Out-Host

Write-Host "Build completed."
Write-Host "EXE: $repoRoot\dist\BXB_Homework_UI.exe"
