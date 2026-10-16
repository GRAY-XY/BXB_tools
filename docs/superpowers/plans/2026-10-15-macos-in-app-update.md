# macOS in-app update implementation plan

**Goal:** Fulfill #33 using the user-approved verified-DMG handoff.
**Architecture:** Dedicated Node manager, native IPC adapter, Swift observation
model and Settings section. Keep Windows updater behavior unchanged.
**Tech stack:** Node 22, node:test, SHA-256 streams, Swift 6, SwiftUI/AppKit.

## Constraints

- macOS 15.0; arm64/x86_64; public stable SwiftUI-tagged DMGs only.
- Current version comes from the native app bundle.
- No download on check; no installer handoff/quit without confirmation.
- Missing checksums, tampered files and open failure cannot cause installation.
- No new assistant tool or student-account action.

## Tasks

- [x] Create `backend/test/macos-updater.test.js`: fixture releases/Response
  streams; assert version/architecture selection, incompatible releases,
  successful checksum verification, failure cleanup, cancellation, tampering,
  symlink rejection and explicit confirmation. Run it before implementation.
- [x] Implement `backend/src/macos-updater.js`: export
  `MacOSUpdateManager({cacheDir, fetchImpl})`, `check({currentVersion, architecture})`,
  `download()`, `status()`, `cancel()`, `prepareInstall({confirmed})`. Return
  snapshots with status/version/progress/verified/download eligibility; return
  a filePath only on successful confirmed prepareInstall.
- [x] Connect `macosUpdate.check/download/status/cancel/prepareInstall` in
  `backend/bridge/winui-backend.js`, requiring native mode; add a real JSONL
  authorization test. Include the tests in `npm run check`.
- [x] Create `MacOSUpdateModel.swift` and `UpdateFlowSmoke.swift`. Check/download
  never open or quit; false confirmation never invokes handoff; true confirmation
  revalidates first; open failure never quits. Compile/run with Swift 6.
- [x] Create `MacOSUpdateView.swift`; add it to Settings and Xcode Sources.
  Display progress and errors; use a confirmation dialog explaining manual
  replacement and quitting. Run the smoke in existing native CI before build.
- [x] Document release naming and installation behavior; review the diff and
  run backend tests, updater smoke, publish scan and workflow validation.
- [x] Commit, create/attach an independent PR for #33, and verify native CI.

## Verification

95 Node tests (86 existing plus 9 updater/IPC tests) pass. Swift update smoke
verifies confirmation, failed opening, failed integrity, stale progress and
stale status errors without opening a real installer or quitting. Native
model/view type checks, workflow validation, project validation and publish
scan pass. PR #38 is independent of release PR #37. Hosted native validation
run 38600102353 passed full Xcode build and packaged-app first launch; the final
state-error guard is revalidated in the subsequent PR run. Live release
discovery reports no public SwiftUI stable release, so it correctly disables
download and installation until #34 publishes a matching artifact.
