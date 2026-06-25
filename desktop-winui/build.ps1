param(
  [ValidateSet("Debug", "Release")]
  [string] $Configuration = "Debug"
)

$ErrorActionPreference = "Stop"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw "vswhere.exe was not found. Install Visual Studio Build Tools 2022 with WinUI/UWP build components."
}

$msbuild = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Workload.UniversalBuildTools -find "MSBuild\Current\Bin\MSBuild.exe" | Select-Object -First 1
if (-not $msbuild) {
  throw "MSBuild with Universal Build Tools was not found. Modify Visual Studio Build Tools and add Microsoft.VisualStudio.Workload.UniversalBuildTools."
}

& $msbuild "$PSScriptRoot\BxbHomework.WinUI.sln" /restore /p:Configuration=$Configuration /p:Platform=x64
exit $LASTEXITCODE
