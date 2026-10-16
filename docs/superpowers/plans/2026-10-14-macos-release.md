# macOS SwiftUI release implementation plan

**Goal:** Implement the self-contained, signed release path in issue #34.

**Architecture:** Preserve the shared JSONL bridge and its relative source tree.
Package a native Node/browser payload, resolve it from the SwiftUI bundle, and
publish only after both architecture builds and notarization succeed.

**Tech stack:** Swift 6, Node.js 22.23.0, Python 3 standard library, shell,
GitHub Actions, Xcode/codesign/notarytool/hdiutil.

## Global constraints

- macOS 15.0 minimum; arm64 and x86_64 packages built on native runners.
- Keep student data and API keys out of build inputs and artifacts.
- Credentials are CI secrets or local keychain entries, never committed.
- No unsigned fallback in the public workflow.

## Task 1: Bundle runtime selection

- [x] Add a Swift smoke test that puts the actual backend client in a temporary
  `.app` with a bundled Node payload. Assert `app.info` identifies the bundle,
  reports packaged status and uses bundled browsers instead of machine caches.
- [x] Run the smoke against the existing code and verify bundled lookup fails.
- [x] Modify `NodeBackendClient.swift` to prefer the complete bundle payload and
  fail closed for incomplete Release apps. Keep development repository lookup.
- [x] Update shared browser discovery to honor `PLAYWRIGHT_BROWSERS_PATH`.
- [x] Verify isolated app/session/workspace JSONL requests with the packaged Node.

## Task 2: Repeatable package and signing

- [x] Add `release/test/macos-release.test.js` for clean staging: allowlisted
  files, version stamping, no sessions/tests, refusal to overwrite a payload.
- [x] Run `node --test release/test/macos-release.test.js` before implementation.
- [x] Add `release/scripts/stage-macos-runtime.js` and an isolated backend/browser
  smoke script; install dependencies from the root lockfile in staging.
- [x] Add `release/scripts/build-swiftui-release.sh`: validate architecture/version,
  verify downloaded Node, build Xcode Release, stage runtime, install Chromium,
  run smoke checks, sign/notarize, make DMG, verify final artifacts and hash them.
- [x] Add nested signing helper and JIT entitlements for the JavaScript runtimes.
- [x] Verify shell syntax, helper tests and staged smoke checks. Full Xcode and
  signing checks run on CI when local prerequisites are unavailable.

## Task 3: CI, documentation and final verification

- [x] Replace the obsolete Flutter workflow with a two-architecture SwiftUI
  workflow, certificate import in a temporary keychain, isolated packaging,
  cleanup and an aggregate draft release upload.
- [x] Add a pull-request CI path that builds unsigned apps and runs packaged
  smoke checks without accessing signing secrets.
- [x] Document exact local commands, secret names and clean-machine checklist.
- [x] Run `npm run check`, new Node release tests, Swift smoke compilation,
  syntax validation and `git diff --check`.
- [ ] Review final diff, commit validated changes, and report external validation
  still required without marking the issue complete.

## Validation record

Integrated with main `253c3ad` and retained the existing Electron workflow.
Backend regression suite: 86 passing tests. Release helper suite: 6 passing tests.
Actionlint and shell/Python syntax checks pass. Bundled runtime and Chromium
launch, Swift locator, missing-payload rejection and Swift JSONL client were
verified on arm64 with isolated data. Local ad-hoc signing verifies resource
seals, but cannot replace Developer ID signing or notarization; hardened
browser launch requires the real shared Team ID for library validation.
Full Xcode builds, Intel execution, notarization and clean-machine acceptance
remain external checks; issue #34 must not be marked complete yet.
