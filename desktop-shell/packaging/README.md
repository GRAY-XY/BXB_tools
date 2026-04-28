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
- The build also bundles `docs/` so the app can open the local user agreement, privacy notice, and release notes directly from the Settings page.
- The build also bundles `config/desktop-policy.json` so the packaged app has a local fallback for version gating and lock policy checks.
- The resulting `.pkg` installs `BXB Student.app` into `/Applications`.
- The package is ad-hoc signed by default. If stricter signing or notarization is needed later, extend the script before release.
- The current installer/user agreement draft is maintained at `docs/legal/BXB_Student_User_Agreement_zh-CN.md` and can be converted into installer resources in a later release step.

## Windows `.exe` / `.zip`

Build the Windows desktop shell bundle from inside Windows:

```powershell
.\desktop-shell\packaging\windows\build_windows_bundle.ps1
```

Or:

```cmd
desktop-shell\packaging\windows\build_windows_bundle.cmd
```

Outputs:

```text
dist/desktop-shell-windows-<timestamp>/BXB Student/BXB Student.exe
dist/desktop-shell-windows-<timestamp>/BXB_Student_Windows_v1.0.1.zip
dist/desktop-shell-windows-<timestamp>/BXB_Student_Windows_v1.0.1_Setup.exe  (if Inno Setup is installed)
```

Notes:

- The Windows build bundles the same `desktop-shell/`, `src/`, `docs/`, `config/`, `node_modules`, Node runtime, and Playwright Chromium runtime used by the macOS build.
- The Windows installer also stages and silently installs `Microsoft Edge WebView2 Runtime` and `Microsoft Visual C++ x64 Runtime`, so login and embedded web content do not depend on the target machine being preconfigured.
- Build on a Windows `x64` Python + Node toolchain when you want a native x64 output. On Windows ARM, the same script can still be run under x64 emulation to produce and validate the x64 package.
- If Playwright Chromium is missing, run `npx playwright install chromium` before packaging.

### One-click x64 handoff

If you want a friend on a real Windows `x64` machine to build and smoke-test the app with one double-click, use:

```text
build_windows_x64_one_click.cmd
```

What it does:

- installs or reuses Windows `x64` Python 3.12, Node.js LTS, and WebView2
- installs or reuses VC++ x64 Runtime and Inno Setup
- installs Python packaging dependencies
- installs project `npm` dependencies
- installs Playwright Chromium
- runs the Windows packaging script
- launches the built app once as a smoke test
