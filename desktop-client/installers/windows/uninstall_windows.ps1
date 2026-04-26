$ErrorActionPreference = "Stop"

$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\BXB Client"
$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\BXB Client"
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "BXB Client.lnk"

function Remove-IfExists($path) {
    if (Test-Path $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
}

Remove-IfExists $DesktopShortcut
Remove-IfExists $StartMenuDir
Remove-IfExists $InstallRoot

Write-Host "[BXB Installer] Uninstall complete."
