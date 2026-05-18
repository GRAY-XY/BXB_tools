# Changelog

## 1.0.2 - 2026-05-18

- Added the new `UI/banxuebang_flutter/` desktop app and kept the existing Node bridge as the bundled runtime layer.
- Added self-contained macOS packaging that bundles `node`, production `node_modules`, Playwright Chromium, release notes, and legal docs into `BXB Student.app`.
- Added Windows installer handoff scripts plus a refreshed GitHub Actions workflow so a Windows teammate can build `.zip` and `Setup.exe` artifacts from the same source tree.
- Polished desktop runtime path resolution and app-support storage so installed builds no longer depend on running inside the repository.

See [docs/releases/1.0.2.md](docs/releases/1.0.2.md) for the release notes shipped inside the app.

## 1.0.1 - 2026-04-28

- Rebuilt the desktop shell around the newer support surfaces, reminder center, release-note view, and admin policy integration.

See [docs/releases/1.0.1.md](docs/releases/1.0.1.md) for the full notes.
