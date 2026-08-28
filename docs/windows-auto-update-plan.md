# Windows Auto Update Plan

This document records the Windows in-app updater design and baseline implementation. The release page remains the manual fallback.

## Target User Flow

1. The user opens `设置 -> 软件更新`.
2. The user clicks `检查更新`.
3. If a newer Windows stable release exists, the app shows version, size, publish time, and release notes.
4. The user clicks `下载并安装`.
5. The app downloads the `.exe` installer into the local update cache.
6. The app verifies file size and SHA256.
7. The app shows `现在重启安装` and `稍后`.
8. If the user confirms, the app starts the installer and quits.
9. The installer overwrites the current version.
10. After installation, the installer starts the new version.

## Release Asset Requirements

Each Windows stable release should upload:

```text
BXB Homework Setup 1.1.7.exe
BXB Homework Setup 1.1.7.exe.sha256
```

If the packager generates a `.blockmap` file, upload it as an additional asset. The in-app updater only requires the `.exe` installer and matching `.sha256` file.

Release title rule:

```text
BXB Homework v<major>.<minor>.<patch>
```

Tag rule:

```text
bxb-homework-v<major>.<minor>.<patch>
```

The GitHub Release must be a normal release, not a prerelease, and should be marked as the latest release.

The `.sha256` file should contain the installer hash, for example:

```text
<sha256>  BXB Homework Setup 1.1.7.exe
```

## Local Cache

Use an update cache under Electron `userData`:

```text
%APPDATA%\bxb-homework-electron\updates\
```

Suggested files:

```text
updates/
  BXB Homework Setup 1.1.7.exe.download
  BXB Homework Setup 1.1.7.exe
  BXB Homework Setup 1.1.7.exe.meta.json
  pending-update.json
```

Always download to `.download` first. Rename to `.exe` only after verification succeeds.

## Main Process IPC

Implement update work in Electron main process, not the renderer.

Suggested IPC handlers:

```text
update:check
update:download
update:install
update:cancel
update:status
```

Suggested preload API:

```js
window.bxb.checkForUpdates()
window.bxb.downloadUpdate()
window.bxb.installUpdate()
window.bxb.cancelUpdateDownload()
window.bxb.getUpdateStatus()
window.bxb.onUpdateProgress(callback)
```

Suggested state shape:

```ts
type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "verifying"
    | "ready_to_install"
    | "installing"
    | "error";
  version?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  percent?: number;
  filePath?: string;
  message?: string;
};
```

## Download And Verification

1. `checkForUpdates()` finds the matching installer asset and SHA256 asset.
2. `downloadUpdate()` downloads the installer to `.download`.
3. Progress is pushed to the renderer.
4. Verify actual bytes match GitHub asset size.
5. Verify SHA256 matches the `.sha256` asset.
6. Rename `.download` to `.exe`.
7. Write metadata JSON.
8. Move state to `ready_to_install`.

If verification fails, delete the downloaded file and require a fresh download.

## Install And Restart

When the user clicks `现在重启安装`:

```js
const { spawn } = require("node:child_process");

const child = spawn(installerPath, [], {
  detached: true,
  stdio: "ignore",
});
child.unref();
app.quit();
```

Start with normal installer mode. Only add silent mode after real installation tests confirm it is reliable.

## NSIS Configuration

To make the app launch after installation, add or verify this in `apps/legacy/electron/package.json` for the legacy Electron package:

```json
"nsis": {
  "oneClick": true,
  "perMachine": false,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "BXB Homework",
  "runAfterFinish": true
}
```

This must be tested with a real installed old version. If `runAfterFinish` does not restart the app for one-click installs, use a helper process or NSIS custom script later.

## Safety Rules

- Only download assets from matched GitHub Releases.
- Only install `.exe` files inside the update cache.
- Only install after size and SHA256 verification pass.
- Do not let the renderer pass arbitrary executable paths to the main process.
- Do not execute arbitrary user-provided URLs.
- Keep `打开 Release 页面` as a fallback.

## Implementation Order

1. Add update cache directory and persisted state.
2. Add in-app download with progress.
3. Add size verification.
4. Add SHA256 asset generation and verification.
5. Add `现在重启安装`.
6. Add `runAfterFinish`.
7. Test old-version-to-new-version replacement on a real installed copy.
