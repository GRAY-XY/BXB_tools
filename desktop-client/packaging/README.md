# Packaging

## Windows `.exe` installer

Build from Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\packaging\windows\build_windows_installer.ps1
```

Output:

```text
dist\windows-installer\BXB_Client_Setup_Windows.exe
```

Notes:

- Uses Inno Setup.
- The build script installs Inno Setup automatically with `winget` if it is missing.
- The installer keeps the existing first-run bootstrap behavior, so Python and Playwright can still self-install on the user's machine.

## macOS `.dmg`

Build from macOS:

```bash
chmod +x ./packaging/macos/build_macos_dmg.sh
./packaging/macos/build_macos_dmg.sh
```

Output:

```text
dist/macos/BXB_Client_macOS_v1.0.0.dmg
```

Notes:

- This must be built on macOS because it uses `hdiutil`.
- The DMG contains a `BXB Client.app` bundle plus the standard `/Applications` shortcut.
- The app now bundles its own Python runtime for macOS.

### macOS signing and notarization

Ad-hoc sign locally:

```bash
chmod +x ./packaging/macos/sign_macos_release.sh
./packaging/macos/sign_macos_release.sh
```

Developer ID sign:

```bash
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
./packaging/macos/sign_macos_release.sh
```

Developer ID sign + notarize with a stored keychain profile:

```bash
xcrun notarytool store-credentials "bxb-notary" \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"

CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
NOTARYTOOL_PROFILE="bxb-notary" \
./packaging/macos/sign_macos_release.sh
```
