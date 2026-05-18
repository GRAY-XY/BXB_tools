# Flutter Desktop Packaging

This directory builds installer outputs for the Flutter desktop app and reuses the user agreement resources from the repository's existing GitHub release flow.

## macOS `.pkg`

```bash
chmod +x ./UI/banxuebang_flutter/packaging/macos/build_macos_pkg.sh
./UI/banxuebang_flutter/packaging/macos/build_macos_pkg.sh
```

Outputs:

```text
dist/banxuebang-flutter-release-<timestamp>/BXB Student.app
dist/banxuebang-flutter-release-<timestamp>/BXB_Student_macOS_v1.0.2.pkg
dist/banxuebang-flutter-release-<timestamp>/BXB_Student_macOS.pkg
```

The package installer shows `docs/legal/BXB_Student_User_Agreement_Installer_zh-CN.txt` as the license page.

## Windows `.exe`

Run the Windows build from a Windows machine:

```powershell
.\UI\banxuebang_flutter\packaging\windows\build_windows_installer.ps1
```

or:

```bat
UI\banxuebang_flutter\packaging\windows\build_windows_installer.cmd
```

Outputs:

```text
dist\banxuebang-flutter-release-<timestamp>\BXB Student\
dist\banxuebang-flutter-release-<timestamp>\BXB_Student_Windows_v1.0.2.zip
dist\banxuebang-flutter-release-<timestamp>\BXB_Student_Windows_v1.0.2_Setup.exe
```

The Windows installer uses Inno Setup and shows the same user agreement text through `LicenseFile`.

## Bundled runtime

Both installers stage a local runtime payload so the app no longer needs to live inside the repo:

- `desktop-shell/node_bridge.js`
- `src/`
- `docs/legal/`
- production `node_modules`
- bundled `node` runtime
- Playwright Chromium cache
