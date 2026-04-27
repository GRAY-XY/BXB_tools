# Desktop Shell Packaging

## macOS `.pkg`

Build the packaged desktop shell app and installer on macOS:

```bash
chmod +x ./desktop-shell/packaging/macos/build_macos_pkg.sh
./desktop-shell/packaging/macos/build_macos_pkg.sh
```

Outputs:

```text
dist/desktop-shell/BXB Student.app
dist/desktop-shell/BXB_Student_macOS_v1.0.1.pkg
dist/desktop-shell/BXB_Student_macOS.pkg
```

Notes:

- The build bundles the current `desktop-shell/` UI, `src/` backend client, `node_modules`, a local `node` runtime, and the Playwright Chromium cache required for credential login.
- The resulting `.pkg` installs `BXB Student.app` into `/Applications`.
- The package is ad-hoc signed by default. If stricter signing or notarization is needed later, extend the script before release.
