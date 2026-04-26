# Installers

This project includes simple platform-specific installers that copy the app into a user-level install location and create a launcher shortcut.

## Windows

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\install_windows.ps1
```

Install location:

```text
%LOCALAPPDATA%\Programs\BXB Client
```

What it does:

- copies the project into the install directory
- creates a desktop shortcut named `BXB Client`
- creates a Start Menu shortcut
- keeps using `start_gui.ps1`, so Python and runtime dependencies are still auto-bootstrapped

Uninstall:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\BXB Client\installers\windows\uninstall_windows.ps1"
```

## macOS

Run:

```bash
chmod +x ./installers/macos/install_macos.command
./installers/macos/install_macos.command
```

Install location:

```text
~/Applications/BXB Client
```

What it does:

- copies the project into `~/Applications/BXB Client`
- creates a desktop launcher named `BXB Client.command`
- keeps using `start_gui.command`, so Python and runtime dependencies are still auto-bootstrapped

Uninstall:

```bash
~/Applications/BXB\ Client/installers/macos/uninstall_macos.command
```
