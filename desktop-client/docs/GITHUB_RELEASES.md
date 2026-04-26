# GitHub Releases

This repository is structured so users can visit the GitHub Releases page and download the package for their platform directly.

## Recommended Release Assets

- `BXB_Client_macOS_v1.0.0.dmg`
- `BXB_Client_macOS.dmg`
- `BXB_Client_Setup_Windows.exe`

If CLI-only builds are distributed later, keep them as separate assets instead of mixing them into the desktop release.

## Recommended Release Title

```text
BXB Client v1.0.0
```

## Recommended Release Notes Structure

1. Summary
2. Downloads
3. First Launch Notes
4. Known Issues

## Example Download Section

```text
Downloads

- macOS (Apple Silicon / Intel): BXB_Client_macOS_v1.0.0.dmg
- Windows: BXB_Client_Setup_Windows.exe
```

## First Launch Notes

### macOS

- If Gatekeeper warns on an unsigned build, right-click the app and choose `Open`.
- The packaged macOS app includes its own Python runtime.
- On first launch, the app may still prepare Playwright browser resources.

### Windows

- The Windows installer keeps the runtime bootstrap flow.
- On first launch, Python or Playwright components may be installed automatically if missing.

## Maintainer Checklist

1. Build the macOS release DMG.
2. Build the Windows installer.
3. Test install and first launch on each platform.
4. Upload the generated artifacts to GitHub Releases.
5. Copy the per-platform download names into the release notes.
