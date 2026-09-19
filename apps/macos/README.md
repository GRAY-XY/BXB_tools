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
