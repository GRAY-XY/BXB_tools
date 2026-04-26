$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptRoot)
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\BXB Client"
$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\BXB Client"
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "BXB Client.lnk"
$StartMenuShortcut = Join-Path $StartMenuDir "BXB Client.lnk"
$LauncherBat = Join-Path $InstallRoot "Launch BXB Client.bat"
$UninstallBat = Join-Path $InstallRoot "Uninstall BXB Client.bat"

function Write-Info($message) {
    Write-Host "[BXB Installer] $message"
}

function New-Shortcut($shortcutPath, $targetPath, $workingDirectory, $iconPath) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $targetPath
    $shortcut.WorkingDirectory = $workingDirectory
    if (Test-Path $iconPath) {
        $shortcut.IconLocation = $iconPath
    }
    $shortcut.Save()
}

Write-Info "Installing to $InstallRoot"
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
New-Item -ItemType Directory -Force -Path $StartMenuDir | Out-Null

$copyArgs = @(
    $ProjectRoot,
    $InstallRoot,
    "/MIR",
    "/XD", ".git", ".github", "__pycache__", "build", "dist"
)
robocopy @copyArgs | Out-Null
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -gt 7) {
    throw "robocopy failed with exit code $robocopyExit"
}

$launcherContent = @"
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_gui.ps1"
endlocal
"@
Set-Content -LiteralPath $LauncherBat -Value $launcherContent -Encoding ASCII

$uninstallContent = @"
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installers\windows\uninstall_windows.ps1"
endlocal
"@
Set-Content -LiteralPath $UninstallBat -Value $uninstallContent -Encoding ASCII

$iconPath = Join-Path $InstallRoot "assets\app_icon_rounded.png"
New-Shortcut -shortcutPath $DesktopShortcut -targetPath $LauncherBat -workingDirectory $InstallRoot -iconPath $iconPath
New-Shortcut -shortcutPath $StartMenuShortcut -targetPath $LauncherBat -workingDirectory $InstallRoot -iconPath $iconPath

Write-Info "Installation complete."
Write-Info "Desktop shortcut: $DesktopShortcut"
Write-Info "Start Menu shortcut: $StartMenuShortcut"
