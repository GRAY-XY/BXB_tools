Requires **macOS 15 or later**.

1. Download the `macos-arm64.dmg` asset for Apple Silicon (M-series), or the
   `macos-x86_64.dmg` asset for an Intel Mac. Apple menu → About This Mac shows
   your chip or processor.
2. Open the DMG and drag **BXB Homework** into **Applications**.
3. Eject the disk image, then launch BXB Homework from Applications.
4. Sign in to Banxuebang. Configure an assistant provider in Settings when needed.

Node.js, the local backend and Chromium are included. No Xcode, Homebrew, npm or
separate Node installation is required. The app and installer are Developer
ID-signed and notarized by Apple; first launch can still show the normal
downloaded-from-the-internet confirmation.

Each DMG has a matching `.sha256` file. In Terminal, change to the download
directory and run `shasum -a 256 -c <downloaded filename>.dmg.sha256` to verify it.

Student sessions, workspace files and assistant settings remain local under
`~/Library/Application Support/bxb-homework-electron`. Credentials saved through
the native login screen use macOS Keychain. Replacing the app preserves local
data. To uninstall, remove BXB Homework from Applications; deleting local data
is a separate action.
