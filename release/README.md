# Release

Release automation, packaging helpers, release-note drafts, and pre-publish checks live here.

- `release/scripts/publish-scan.js` checks for known local-only or sensitive files before publishing.
- `release/scripts/build-windows-exe.ps1` keeps the older standalone Windows EXE build helper.
- Windows WinUI installer packaging remains with the app at `apps/windows/winui/package-winui.ps1` because it depends on the WinUI project layout.
