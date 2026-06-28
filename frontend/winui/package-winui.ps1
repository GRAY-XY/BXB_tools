param(
  [ValidateSet("Debug", "Release")]
  [string] $Configuration = "Release",
  [string] $Version = "",
  [switch] $SkipBuild,
  [switch] $SkipInstaller
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$repoRootPath = $repoRoot.Path
$distRoot = Join-Path $repoRootPath "dist-winui-app"
$unpackedDir = Join-Path $distRoot "winui-unpacked"
$resourcesDir = Join-Path $unpackedDir "resources"
$payloadDir = Join-Path $resourcesDir "payload"
$nodeDir = Join-Path $resourcesDir "node"
$buildOutput = Join-Path $PSScriptRoot "BxbHomework.WinUI\bin\x64\$Configuration\net8.0-windows10.0.19041.0"
$nodeZip = Join-Path $repoRootPath "build_assets\node-v22.15.0-win-x64.zip"
$browserZip = Join-Path $repoRootPath "build_assets\ms-playwright-browsers.zip"
$nsiScript = Join-Path $PSScriptRoot "installer\winui-installer.nsi"
$iconFile = Join-Path $PSScriptRoot "BxbHomework.WinUI\Assets\BxbIcon.ico"

function Remove-WorkspaceDirectory {
  param([string] $Path)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetFullPath($repoRootPath)
  if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside repository: $fullPath"
  }
  if (Test-Path -LiteralPath $fullPath) {
    Remove-Item -LiteralPath $fullPath -Recurse -Force
  }
}

function Copy-DirectoryContent {
  param(
    [string] $Source,
    [string] $Destination
  )
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing source: $Source"
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Find-Makensis {
  $fromPath = Get-Command makensis.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $cacheRoot = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\nsis"
  if (Test-Path -LiteralPath $cacheRoot) {
    $candidate = Get-ChildItem -LiteralPath $cacheRoot -Recurse -Filter makensis.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }

  throw "makensis.exe was not found. Build the Electron app once or install NSIS."
}

if (-not $Version) {
  $desktopPackage = Get-Content (Join-Path $repoRootPath "frontend\electron\package.json") -Raw | ConvertFrom-Json
  $Version = [string] $desktopPackage.version
}
$numericVersionMatch = [regex]::Match($Version, "^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)")
$numericVersion = if ($numericVersionMatch.Success) {
  "$($numericVersionMatch.Groups["major"].Value).$($numericVersionMatch.Groups["minor"].Value).$($numericVersionMatch.Groups["patch"].Value).0"
} else {
  "0.0.0.0"
}

if (-not $SkipBuild) {
  & (Join-Path $PSScriptRoot "build.ps1") -Configuration $Configuration
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

if (-not (Test-Path -LiteralPath $buildOutput)) {
  throw "Build output was not found: $buildOutput"
}
if (-not (Test-Path -LiteralPath $nodeZip)) {
  throw "Bundled Node runtime was not found: $nodeZip"
}
if (-not (Test-Path -LiteralPath $browserZip)) {
  throw "Bundled Playwright browser archive was not found: $browserZip"
}
if (-not (Test-Path -LiteralPath $iconFile)) {
  throw "Application icon was not found: $iconFile"
}

Remove-WorkspaceDirectory $distRoot
New-Item -ItemType Directory -Path $unpackedDir -Force | Out-Null

Get-ChildItem -LiteralPath $buildOutput -Force | ForEach-Object {
  if ($_.Name -eq "BXBHomework.exe.WebView2") {
    return
  }
  if ($_.Extension -eq ".pdb") {
    return
  }
  Copy-Item -LiteralPath $_.FullName -Destination $unpackedDir -Recurse -Force
}

New-Item -ItemType Directory -Path $payloadDir -Force | Out-Null
Copy-DirectoryContent -Source (Join-Path $repoRootPath "backend\src") -Destination (Join-Path $payloadDir "backend\src")
Copy-DirectoryContent -Source (Join-Path $repoRootPath "backend\bridge") -Destination (Join-Path $payloadDir "backend\bridge")
Copy-DirectoryContent -Source (Join-Path $repoRootPath "node_modules") -Destination (Join-Path $payloadDir "node_modules")
Copy-Item -LiteralPath (Join-Path $repoRootPath "package.json") -Destination (Join-Path $payloadDir "package.json") -Force
New-Item -ItemType Directory -Path (Join-Path $payloadDir "frontend\electron") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRootPath "frontend\electron\package.json") -Destination (Join-Path $payloadDir "frontend\electron\package.json") -Force
New-Item -ItemType Directory -Path (Join-Path $payloadDir "runtime") -Force | Out-Null
Copy-Item -LiteralPath $browserZip -Destination (Join-Path $payloadDir "runtime\ms-playwright-browsers.zip") -Force

$nodeTemp = Join-Path ([System.IO.Path]::GetTempPath()) ("bxb-winui-node-" + [System.Guid]::NewGuid().ToString("N"))
try {
  Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeTemp -Force
  $nodeRoot = Get-ChildItem -LiteralPath $nodeTemp -Directory | Select-Object -First 1
  if (-not $nodeRoot) {
    throw "Node runtime archive did not contain a root directory."
  }
  New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $nodeRoot.FullName "node.exe") -Destination (Join-Path $nodeDir "node.exe") -Force
  Copy-Item -LiteralPath (Join-Path $nodeRoot.FullName "LICENSE") -Destination (Join-Path $nodeDir "LICENSE.node.txt") -Force
} finally {
  if (Test-Path -LiteralPath $nodeTemp) {
    Remove-Item -LiteralPath $nodeTemp -Recurse -Force
  }
}

if (-not $SkipInstaller) {
  $makensis = Find-Makensis
  $installerPath = Join-Path $distRoot "BXB Homework Setup $Version.exe"
  & $makensis "/DAPP_VERSION=$Version" "/DAPP_VERSION_NUMERIC=$numericVersion" "/DSOURCE_DIR=$unpackedDir" "/DOUT_FILE=$installerPath" "/DICON_FILE=$iconFile" $nsiScript
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $hash = Get-FileHash -LiteralPath $installerPath -Algorithm SHA256
  Set-Content -LiteralPath "$installerPath.sha256" -Value "$($hash.Hash.ToLowerInvariant())  $(Split-Path $installerPath -Leaf)" -Encoding ASCII
}

Write-Host "Windows package completed."
Write-Host "Unpacked: $unpackedDir"
if (-not $SkipInstaller) {
  Write-Host "Installer: $(Join-Path $distRoot "BXB Homework Setup $Version.exe")"
}
