# Desktop Release Guide

This directory contains the desktop release instructions, packaging scripts, and generated release files. Generated binaries and checksums go under `release/artifacts/`; that directory is ignored by Git so installers are not accidentally committed.

## Before a release

1. Choose a version for the platform being released. Windows and macOS versions are independent: update `apps/legacy/electron/package.json` for Windows or `apps/macos/package.json` for macOS, and keep that app's lockfile in sync.
2. Run the repository checks and the publish scan:

   ```sh
   npm ci
   npm run check
   npm run scan:publish
   ```

3. Commit the release source and create the platform-specific tag and GitHub Release. Use `bxb-homework-v<version>` for Windows (for example, `bxb-homework-v1.2.0`) and `bxb-homework-macos-v<version>` for macOS (for example, `bxb-homework-macos-v1.2.0`).
4. Use a platform-specific release title and add the English release notes before uploading that platform's package.

The Windows installer version comes from `apps/legacy/electron/package.json`; the macOS app version comes from `apps/macos/package.json`. Windows releases use the title `BXB Homework v<version>`, and macOS releases use `BXB Homework macOS v<version>`. The updater reads only its platform's title prefix, so each app can keep its own version.

## Windows (WinUI)

On Windows, install Visual Studio 2022 Build Tools with the .NET desktop and Windows App SDK/WinUI components, plus NSIS. Install the repository dependencies with `npm ci`, then run from the repository root:

```powershell
npm run scan:publish
.\apps\windows\winui\package-winui.ps1 -Configuration Release
```

The package script builds the WinUI app, prepares the bundled Node 22.15.0 runtime (verified against Node.js' published SHA-256 list) and Playwright Chromium archive, then creates the per-user NSIS installer and its SHA-256 sidecar.

Output:

```text
release/artifacts/windows/winui-unpacked/BxbHomework.WinUI.exe
release/artifacts/windows/BXB Homework Setup <version>.exe
release/artifacts/windows/BXB Homework Setup <version>.exe.sha256
```

Upload the installer and its sidecar to the existing GitHub Release. For example:

```powershell
$Version = (Get-Content apps/legacy/electron/package.json -Raw | ConvertFrom-Json).version
$ReleaseTag = "bxb-homework-v$Version"
gh release upload $ReleaseTag `
  "release/artifacts/windows/BXB Homework Setup $Version.exe" `
  "release/artifacts/windows/BXB Homework Setup $Version.exe.sha256" `
  --clobber
```

## macOS (Electron + React)

The current macOS release is the Electron + React app in `apps/macos/`. The SwiftUI app is still an incremental migration and does not yet have a release package flow.

For a local build on macOS, install Node.js from `.nvmrc`, then install dependencies and package with the release tag:

```sh
npm ci
npm ci --prefix apps/macos
bash ./release/scripts/build-macos-release.sh bxb-homework-macos-v<version>
```

The script checks that the macOS app version matches its platform-specific tag, runs the publish scan, builds x64 and arm64 DMGs, and writes a `.sha256` sidecar for each DMG. The packaged app uses its bundled Electron runtime and Playwright CLI to download Chromium for the user's architecture on first use, so the DMG does not include a build-machine-specific browser archive; that first download requires internet access. Output is placed in:

```text
release/artifacts/macos/
```

To build on GitHub Actions, create the GitHub Release first, then run **Build macOS Release** with its tag. The workflow checks out that tag, verifies that the release exists, builds the packages, and uploads the DMGs and checksums to that Release.

The current macOS packaging configuration does not provide Developer ID signing or notarization. Add those credentials and notarization steps before describing a build as signed or notarized.

## Other helpers

- `scripts/publish-scan.js` checks for known local-only or sensitive paths. Run it before packaging and publishing.
- `scripts/build-windows-exe.ps1` is the older standalone Tk/PyInstaller build helper; it is not the current WinUI installer flow.
- `artifacts/` contains local build output only and is intentionally excluded from Git.
