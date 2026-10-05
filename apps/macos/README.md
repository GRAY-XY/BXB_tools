# macOS App

The active macOS client is the Electron + React app in this directory. It reuses
the shared local capability layer under `backend/src/`.

## Prerequisites

- macOS on Apple silicon or Intel
- Node.js 22.23.0 (pinned in the repository `.nvmrc`)
- npm
- Xcode for future native SwiftUI work, code signing, and notarization

With `nvm` installed, select the project runtime from the repository root:

```sh
nvm install
nvm use
npm ci
```

Then install and verify the macOS client:

```sh
cd apps/macos
npm ci
npm run check
```

If Electron downloads need the macOS system proxy, expose it to the installer
for that command. For example:

```sh
ELECTRON_GET_USE_PROXY=1 \
HTTPS_PROXY=http://127.0.0.1:10808 \
HTTP_PROXY=http://127.0.0.1:10808 \
npm ci
```

## Development

Start Vite and Electron together:

```sh
npm start
```

Build the renderer without launching the desktop app:

```sh
npm run check
```

The native SwiftUI client shell lives under `apps/macos/swiftui/`. It migrates
incrementally while the Electron client remains usable.

## Package for release

The release package is a DMG for Intel and Apple silicon. Install both dependency sets and run the release script from the repository root, using the tag of an existing GitHub Release:

```sh
npm ci
npm ci --prefix apps/macos
bash ./release/scripts/build-macos-release.sh bxb-homework-macos-v<version>
```

The script checks that the macOS app version matches its platform-specific release tag (`bxb-homework-macos-v<version>`), runs the publish scan, and writes DMGs with SHA-256 sidecars to `release/artifacts/macos/`. Windows and macOS releases use independent versions and titles. When a user first needs browser-backed tools, the app uses its bundled Electron runtime and Playwright CLI to download Chromium for that Mac's architecture; this first download requires an internet connection, but users do not need to install Node.js separately.

The **Build macOS Release** GitHub Actions workflow performs the same package build and uploads those files to the existing Release.

Developer ID signing and notarization are not configured yet. See [`release/README.md`](../../release/README.md) for the complete Windows and macOS release process.
