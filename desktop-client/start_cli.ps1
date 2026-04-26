$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

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

& $python "$ProjectRoot\bootstrap_runtime.py" --mode cli
if ($LASTEXITCODE -ne 0) {
    throw "Runtime bootstrap failed."
}

$env:BXB_RUNTIME_BOOTSTRAPPED = "1"
& $python "$ProjectRoot\banxuebang.py" @args
