# Native macOS releases

The macOS release is the SwiftUI client in `apps/macos/swiftui/`, packaged with
Node, the shared backend, locked production npm dependencies and Playwright
Chromium. Supported targets are **Apple Silicon arm64** and **Intel x86_64**,
running **macOS 15.0 or later**. Each package must be built on its native
architecture so browser downloads and native npm modules match the app.

## Local verification

Use a complete Xcode installation with a Swift 6 toolchain selected through
`xcode-select`. Command Line Tools alone cannot build the Xcode project.

```sh
npm ci
npm run check
npm run check:macos-release
bash release/scripts/build-swiftui-release.sh --version 0.1.0 --arch arm64 --unsigned
```

For Intel use `--arch x86_64` on an Intel Mac. An unsigned developer DMG is named
with `-unsigned`; it is not a public release. Build output defaults to
`dist/macos/<version>/<architecture>/`. Use a fresh `--output` directory for a
repeat build; existing output and runtime payloads are not overwritten.

The packager downloads the exact Node version in `.nvmrc`, checks its official
SHA-256, builds the Release app, installs dependencies with `npm ci --omit=dev`,
and downloads Chromium through the staged Playwright CLI. It copies only
backend source, the macOS bridge entry point, package manifests and the license;
repository sessions, model configurations, tests and workspace files are not
build inputs. Version and build number are stamped into the app and staged
backend without modifying development package manifests.

## Signed local build

Import a **Developer ID Application** certificate and its private key into your
keychain. Store notarization credentials using Apple's `notarytool`:

```sh
xcrun notarytool store-credentials bxb-release \
  --key /secure/path/AuthKey.p8 --key-id YOUR_KEY_ID --issuer YOUR_ISSUER_ID
export MACOS_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)'
export MACOS_NOTARY_PROFILE=bxb-release
bash release/scripts/build-swiftui-release.sh --version 1.2.3 --arch arm64
```

An optional `MACOS_SIGNING_KEYCHAIN` selects the keychain containing both the
certificate and notary profile. `MACOS_BUILD_NUMBER` overrides the default app
build number (`1`). The host is signed without JavaScript entitlements; Node and
Chromium use the dedicated JIT/runtime entitlements. All nested Mach-O code is
signed before its enclosing bundles, then signatures are checked. Both the app
and final DMG are notarized, stapled and assessed by Gatekeeper. No signed mode
step silently falls back to an unsigned artifact. Checksums are generated after
the final stapling step.

Apple reference: [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## GitHub Actions setup

Configure these repository Actions secrets:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded Developer ID Application certificate **with private key**, exported as P12 |
| `MACOS_CERTIFICATE_PASSWORD` | P12 export password |
| `MACOS_SIGNING_IDENTITY` | Full identity, `Developer ID Application: Name (TEAMID)` |
| `MACOS_NOTARY_KEY_P8` | App Store Connect API private key contents |
| `MACOS_NOTARY_KEY_ID` | API key ID |
| `MACOS_NOTARY_ISSUER_ID` | API issuer ID |

The workflow imports them into a temporary keychain, stores its notarization
profile, and deletes credentials and restores the previous keychain search list
even on failure. Pull requests build unsigned artifacts without signing secrets.
Native runner labels follow [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

After the changes land, push a stable `bxb-homework-swiftui-vX.Y.Z` tag, or dispatch **Build macOS
SwiftUI Release** with an existing tag containing this release implementation.
Both architecture jobs must succeed before the release job verifies their
checksums and uploads the two DMGs and checksum files. Native tags and release titles (`BXB Homework SwiftUI vX.Y.Z`) are separate from
Electron and Windows so their updaters do not select native artifacts. New GitHub Releases are
created as drafts with `installation-notes.md`; publish the draft after the
clean-machine acceptance below. Existing release notes are preserved and existing
assets are never silently overwritten. This implementation does not add the
in-app updater requested separately in issue #33.

## Automated and clean-machine acceptance

`test-macos-bundle.sh` copies the app to a temporary location, compiles smoke
executables in that copy, verifies runtime lookup ignores developer overrides,
and rejects an incomplete bundle. The actual Swift JSONL client is run with a
temporary Foundation home, which is checked before starting the backend. A
second smoke uses the bundled Node under a minimal environment, checks packaged
status/version and browser discovery, writes an isolated workspace file, and
launches the bundled Chromium on a local HTML page. No student account or model
key is needed. Node/browser smoke is repeated after hardened-runtime signing.

Before publishing a draft, record the release tag, architecture, macOS version
and result for each of these checks on clean supported Macs:

- [ ] Download the actual DMG from the draft release and verify its `.sha256`.
- [ ] Use a fresh user with no Node, npm, Homebrew, Xcode, repository checkout,
  prior BXB data or Playwright cache. Leave Gatekeeper enabled.
- [ ] Drag the app into Applications, eject the DMG and launch from Finder.
- [ ] Confirm no missing runtime or unverified-developer error appears.
- [ ] Sign in explicitly, load courses/homework, and check workspace persistence.
- [ ] Configure a provider explicitly and check one assistant request if available.
- [ ] Exercise a browser-dependent action such as browser login or web search.
- [ ] Quit/reopen and confirm data persists; replace the app and check again.
- [ ] Run `codesign --verify --deep --strict` and `spctl --assess --type execute`
  against the installed app, and `xcrun stapler validate` where developer tools
  are available on a separate verification machine.

A GitHub runner has developer tools and is not a substitute for this final
clean-machine acceptance. Issue #34 remains open until signed artifacts are
published and clean first-launch evidence is recorded.
