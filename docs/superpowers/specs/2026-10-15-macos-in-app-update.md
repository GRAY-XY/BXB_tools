# macOS in-app update flow (#33)

Add an update section to native Settings without interrupting normal use.
The user approved manual installation: after a verified download, explicitly
confirm opening the DMG and quitting; drag the updated app to Applications and
launch it manually. Canceling confirmation leaves the app running. Automatic
replacement would need an installer/helper and permission recovery; Sparkle
would additionally require a feed and signing-key release integration. Neither
is needed for the approved flow.

Use the installed app's CFBundleShortVersionString, not the shared Windows
backend's version. Check only public stable releases tagged
`bxb-homework-swiftui-vX.Y.Z`. Match the current arm64/x86_64 app architecture
against `BXBHomework-vX.Y.Z-macos-ARCH.dmg` and its exact `.sha256` sidecar, the
native release contract defined for #34. Exclude drafts, prereleases, Electron,
Windows, unsigned development artifacts and mismatched versions. Select the
newest compatible update; if none is compatible, explain that explicitly.

An independent Node update manager handles public GitHub discovery, bounded
downloads, cancellation, progress and SHA-256 verification. Its methods are
native-user IPC commands, not assistant tools. Download into a private partial
file; expose installation only after byte-count and checksum verification.
Recheck integrity and reject symlinks immediately before installer handoff.
Network errors, missing sidecars and corrupt downloads must leave installation
disabled. Checking never downloads, mounts, quits or relaunches anything.

A Swift observation model consumes typed snapshots and polls download progress.
The Settings section shows installed/available versions, clear status, download
progress, retry/cancel and release notes. Its installer action requires a true
confirmation parameter and a verified ready state. NSWorkspace opens only the
backend's reverified local DMG; terminate only when opening succeeds. Open
failure retains the running application and reports an error. No automatic
relaunch is provided.

Test release selection and real cache-file/hash/cancellation behavior with
controlled HTTP responses. Test native bridge authorization and Swift model
confirmation/open/quit behavior without affecting accounts or exiting the test
runner. Run the existing backend suite and full Xcode CI. Formal signed updates
remain dependent on publishing #34's signed native artifacts; updater tests use
fixtures and do not claim a published signed release exists.
