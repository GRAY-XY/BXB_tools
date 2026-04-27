param(
    [string]$ProjectRoot = "",
    [string]$PythonExe = ""
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

function Resolve-PythonExe {
    param([string]$RequestedPython)

    if ($RequestedPython -and (Test-Path $RequestedPython)) {
        return $RequestedPython
    }

    foreach ($candidate in @("py -3.12", "python", "python3")) {
        try {
            if ($candidate -eq "py -3.12") {
                $resolved = & py -3.12 -c "import sys; print(sys.executable)" 2>$null
            } else {
                $resolved = & $candidate -c "import sys; print(sys.executable)" 2>$null
            }
            if ($resolved) {
                return ($resolved | Select-Object -First 1).Trim()
            }
        } catch {
        }
    }

    throw "Python 3.12 was not found for Windows runtime preparation."
}

function Invoke-RobocopyMirror {
    param(
        [string]$Source,
        [string]$Destination
    )

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    & robocopy $Source $Destination /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD "__pycache__" "test" "tests" "Doc" "Docs" "Tools" "tcl\tix8.4.3" /XF "*.pyc" | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "robocopy failed while copying runtime (exit code $LASTEXITCODE)."
    }
}

$ResolvedPython = Resolve-PythonExe -RequestedPython $PythonExe
$PythonRoot = (& $ResolvedPython -c "import sys; print(sys.base_prefix)" | Select-Object -First 1).Trim()
if (-not (Test-Path $PythonRoot)) {
    throw "Python base runtime root not found: $PythonRoot"
}

$RuntimeRoot = Join-Path $ProjectRoot "build\windows-runtime"
$BundledPythonRoot = Join-Path $RuntimeRoot "python"
$BundledBrowserRoot = Join-Path $RuntimeRoot "ms-playwright"

Write-Host "[BXB Build] Using Python executable: $ResolvedPython"
Write-Host "[BXB Build] Copying runtime from: $PythonRoot"

if (Test-Path $RuntimeRoot) {
    Remove-Item -Recurse -Force $RuntimeRoot
}
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
Invoke-RobocopyMirror -Source $PythonRoot -Destination $BundledPythonRoot

$BundledPythonExe = Join-Path $BundledPythonRoot "python.exe"
if (-not (Test-Path $BundledPythonExe)) {
    throw "Bundled python.exe was not created."
}

Write-Host "[BXB Build] Installing Python packages into bundled runtime..."
& $BundledPythonExe -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    throw "Failed to upgrade pip in bundled runtime."
}
& $BundledPythonExe -m pip install "requests>=2.31" "playwright>=1.40"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install Python packages into bundled runtime."
}

Write-Host "[BXB Build] Installing Playwright Chromium into bundled runtime..."
$env:PLAYWRIGHT_BROWSERS_PATH = $BundledBrowserRoot
& $BundledPythonExe -m playwright install chromium
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install Playwright Chromium into bundled runtime."
}

Write-Host "[BXB Build] Bundled runtime ready at $RuntimeRoot"
