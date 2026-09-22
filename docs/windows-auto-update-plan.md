# Windows Auto Update Plan

This document records the implemented Windows in-app updater. The release page remains the manual fallback.

## Target User Flow

1. The user opens `设置 -> 软件更新`.
2. The user clicks `检查更新`.
3. If a newer Windows stable release exists, the app shows version, size, publish time, and release notes.
4. The user clicks `下载并安装`.
5. The app downloads the `.exe` installer into the local update cache.
6. The app verifies file size and SHA256.
7. The app shows `现在重启安装`; closing Settings or leaving it untouched is equivalent to choosing later.
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

## Desktop Backend Methods

Update work runs in the trusted desktop backend, not in the WinUI page. WinUI calls the backend through `NodeBackendClient`.

Backend methods:

```text
update:check
update:download
update:install
update:cancel
update:status
```

The legacy Electron client exposes equivalent preload methods:

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
3. WinUI polls `update:status` while the download request is active and renders the returned bytes and percentage in a progress bar. The legacy Electron client receives equivalent progress events.
4. Verify actual bytes match GitHub asset size.
5. Verify SHA256 matches the `.sha256` asset.
6. Rename `.download` to `.exe`.
7. Write metadata JSON.
8. Move state to `ready_to_install`.

If verification fails, delete the downloaded file and require a fresh download.

## Install And Restart

When the user clicks `现在重启安装`, WinUI asks for confirmation and calls `update:install`. The backend starts a detached hidden PowerShell helper that waits briefly before launching the verified installer. WinUI then exits, so the installer can replace files that were in use.

The installer runs in normal interactive mode. After a successful copy, it removes `pending-update.json` and starts `BXBHomework.exe`. Silent `/S` installs skip automatic launch so local packaging and deployment scripts remain deterministic.

## Installer Configuration

The current WinUI installer is defined in `apps/windows/winui/installer/winui-installer.nsi`. Its install section performs the restart for normal installs. The legacy Electron package still uses this NSIS setting:

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

Every release still needs a real old-version-to-new-version installation test because file locking, antivirus and installer elevation can affect replacement behavior.

## Safety Rules

- Only download assets from matched GitHub Releases.
- Only install `.exe` files inside the update cache.
- Only install after size and SHA256 verification pass.
- Do not let the renderer pass arbitrary executable paths to the main process.
- Do not execute arbitrary user-provided URLs.
- Keep `打开 Release 页面` as a fallback.

## Implemented Baseline

The WinUI client now includes the update cache, persisted pending state, in-app progress, size and SHA256 verification, restart confirmation, delayed installer launch and post-install relaunch. A real released old-version-to-new-version test remains required for each release candidate.
