Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$buildAssets = Join-Path $repoRoot.Path "build_assets"
$nodeVersion = "22.15.0"
$nodeArchiveName = "node-v$nodeVersion-win-x64.zip"
$nodeArchivePath = Join-Path $buildAssets $nodeArchiveName
$nodeBaseUrl = "https://nodejs.org/dist/v$nodeVersion"
$browserArchivePath = Join-Path $buildAssets "ms-playwright-browsers.zip"
$browserRoot = if ($env:PLAYWRIGHT_BROWSERS_PATH) {
  [System.IO.Path]::GetFullPath($env:PLAYWRIGHT_BROWSERS_PATH)
} else {
  Join-Path $env:LOCALAPPDATA "ms-playwright"
}

New-Item -ItemType Directory -Path $buildAssets -Force | Out-Null

$checksumsText = (Invoke-WebRequest -Uri "$nodeBaseUrl/SHASUMS256.txt").Content
$checksumPattern = "^(?<hash>[a-fA-F0-9]{64})\s+$([regex]::Escape($nodeArchiveName))\s*$"
$checksumLine = $checksumsText -split "`r?`n" | Where-Object { $_ -match $checksumPattern } | Select-Object -First 1
if (-not $checksumLine -or $checksumLine -notmatch $checksumPattern) {
  throw "Could not find the official SHA-256 for $nodeArchiveName."
}
$expectedNodeHash = $Matches.hash.ToLowerInvariant()

$downloadNodeArchive = $true
if (Test-Path -LiteralPath $nodeArchivePath) {
  $existingNodeHash = (Get-FileHash -LiteralPath $nodeArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $downloadNodeArchive = $existingNodeHash -ne $expectedNodeHash
}
if ($downloadNodeArchive) {
  Write-Host "Downloading and verifying Node.js $nodeVersion runtime..."
  Invoke-WebRequest -Uri "$nodeBaseUrl/$nodeArchiveName" -OutFile $nodeArchivePath
}
$actualNodeHash = (Get-FileHash -LiteralPath $nodeArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualNodeHash -ne $expectedNodeHash) {
  Remove-Item -LiteralPath $nodeArchivePath -Force -ErrorAction SilentlyContinue
  throw "Node.js archive SHA-256 verification failed. Expected $expectedNodeHash, got $actualNodeHash."
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot.Path "node_modules\playwright"))) {
  throw "Root dependencies are missing. Run npm ci before packaging so Playwright can be installed."
}

Write-Host "Installing or updating the Playwright Chromium runtime for Windows..."
$previousBrowsersPath = $env:PLAYWRIGHT_BROWSERS_PATH
try {
  $env:PLAYWRIGHT_BROWSERS_PATH = $browserRoot
  Push-Location $repoRoot.Path
  & npx.cmd playwright install chromium
  if ($LASTEXITCODE -ne 0) {
    throw "Playwright Chromium installation failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
  $env:PLAYWRIGHT_BROWSERS_PATH = $previousBrowsersPath
}

$chromiumExecutable = Get-ChildItem -LiteralPath $browserRoot -Directory -Filter "chromium-*" -ErrorAction SilentlyContinue |
  Where-Object {
    (Test-Path -LiteralPath (Join-Path $_.FullName "chrome-win64\chrome.exe")) -or
    (Test-Path -LiteralPath (Join-Path $_.FullName "chrome-win\chrome.exe"))
  } |
  Select-Object -First 1
if (-not $chromiumExecutable) {
  throw "Playwright installed without a Windows Chromium executable under $browserRoot."
}

Write-Host "Creating the Playwright browser payload..."
Remove-Item -LiteralPath $browserArchivePath -Force -ErrorAction SilentlyContinue
$archiveScript = @'
from pathlib import Path
import sys
import zipfile

source_root = Path(sys.argv[1])
target_zip = Path(sys.argv[2])
ignored_directories = {".links", "__dirlock", "daemon"}
target_zip.parent.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(target_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(source_root.rglob("*")):
        relative_path = path.relative_to(source_root)
        if path.is_dir() or any(part in ignored_directories for part in relative_path.parts):
            continue
        archive.write(path, relative_path)
'@
$archiveScript | python - $browserRoot $browserArchivePath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create the Playwright browser archive."
}
if (-not (Test-Path -LiteralPath $browserArchivePath) -or (Get-Item -LiteralPath $browserArchivePath).Length -eq 0) {
  throw "Playwright browser archive was not created: $browserArchivePath"
}

Write-Host "Windows packaging assets are ready."
Write-Host "Node runtime: $nodeArchivePath"
Write-Host "Playwright browsers: $browserArchivePath"
