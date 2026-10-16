# macOS SwiftUI distribution (#34)

The approved approach is a self-contained, per-architecture app distributed as a
DMG, with a Developer ID signature and Apple notarization before publication.
Separate arm64 and x86_64 builds avoid mixing Node, native npm modules and Chromium
architectures. A universal app would still need two backend/browser payloads;
requiring users to install Node would violate the issue's acceptance criteria.

## Runtime

Place Node in `Contents/Helpers/node`, the allowlisted JavaScript source tree and
production dependencies in `Contents/Resources/BXBRuntime`, and Playwright browsers
in `Contents/Resources/Playwright`. Preserve backend relative imports. Release
apps resolve only bundled resources, ignoring development overrides; Debug and
command-line development retain repository lookup. Durable data stays in the
existing `~/Library/Application Support/bxb-homework-electron` location. A missing
payload produces a repair/reinstall error rather than using another Node version.

## Release pipeline

Build on native GitHub macOS 15 arm64 and Intel runners, with the Node version
pinned by `.nvmrc`. Download Node with SHA-256 verification and install locked
production dependencies in a clean staging directory. Install Chromium using
the staged Playwright CLI. Stamp app and backend versions from the release tag.
Test the staged backend and browser with a temporary user-data directory and a
minimal environment; do not read real student sessions or provider keys.

Sign nested Mach-O binaries and bundles from the inside out. Apply JavaScript
runtime entitlements to Node/Chromium, without weakening the SwiftUI host. Verify
signatures, notarize and staple the app, create a DMG with an Applications link,
then notarize, staple and verify the final DMG. Hash only the final artifacts.
Publish both architectures, checksums and installation notes together, after
both builds succeed. Missing credentials or failed checks fail the public build;
an explicit unsigned local mode is for developer verification only.

## Acceptance and limits

Minimum system: macOS 15.0. Installation notes include architecture choice,
dragging the app to Applications and first launch. Automated smoke checks cover
isolated runtime selection, packaged bridge status, workspace persistence and
Chromium launch. Manual release acceptance also requires downloading and launching
on clean supported Macs with Gatekeeper enabled and no developer tools. Full
Xcode, Developer ID credentials and clean Macs are external prerequisites; do
not claim signed publication or manual acceptance until those are performed.
