$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundledPython = Join-Path $ProjectRoot "runtime\python\python.exe"
$BundledPythonGui = Join-Path $ProjectRoot "runtime\python\pythonw.exe"
$BundledBrowserRoot = Join-Path $ProjectRoot "runtime\ms-playwright"

function Use-BundledRuntime {
    if (-not (Test-Path $BundledPython)) {
        return $false
    }

    $env:PLAYWRIGHT_BROWSERS_PATH = $BundledBrowserRoot
    $env:BXB_RUNTIME_BOOTSTRAPPED = "1"
    $env:PYTHONUTF8 = "1"

    if (Test-Path $BundledPythonGui) {
        & $BundledPythonGui "$ProjectRoot\banxuebang_gui.py"
    } else {
        & $BundledPython "$ProjectRoot\banxuebang_gui.py"
    }
    return $true
}

if (Use-BundledRuntime) {
    exit $LASTEXITCODE
}

function Find-Python {
    $candidates = @()

    $command = Get-Command python -ErrorAction SilentlyContinue
    if ($command -and $command.Source -notlike "*WindowsApps*") {
        $candidates += $command.Source
    }

    $command3 = Get-Command python3 -ErrorAction SilentlyContinue
    if ($command3 -and $command3.Source -notlike "*WindowsApps*") {
        $candidates += $command3.Source
    }

    $knownRoots = @(
        "$env:LOCALAPPDATA\Programs\Python",
        "$env:ProgramFiles\Python*",
        "$env:ProgramFiles\Python"
    )

    foreach ($root in $knownRoots) {
        $matches = Get-ChildItem $root -Recurse -Filter python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
        if ($matches) {
            $candidates += $matches
        }
    }

    return $candidates | Select-Object -Unique | Select-Object -First 1
}

$python = Find-Python
if (-not $python) {
    Write-Host "Python not found. Installing Python 3.12 with winget..."
    winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements --disable-interactivity
    $python = Find-Python
}

if (-not $python) {
    throw "Python installation failed or could not be located."
}

& $python "$ProjectRoot\bootstrap_runtime.py" --mode gui
if ($LASTEXITCODE -ne 0) {
    throw "Runtime bootstrap failed."
}

$env:BXB_RUNTIME_BOOTSTRAPPED = "1"
$pythonGui = Join-Path (Split-Path -Parent $python) "pythonw.exe"
if (Test-Path $pythonGui) {
    & $pythonGui "$ProjectRoot\banxuebang_gui.py"
} else {
    & $python "$ProjectRoot\banxuebang_gui.py"
}
