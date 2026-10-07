# SwiftUI Cloud Validation Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current session; the user has approved cloud build, automated tests and a downloadable test app.

**Goal:** Verify PR #35 on a GitHub-hosted Mac with full Xcode, without installing Xcode on the user's computer.

**Architecture:** A read-only pull-request workflow uses macos-15 (arm64), pinned project Node, existing backend and Swift smoke tests, and an unsigned Xcode build. It verifies the packaged Node bridge in a temporary directory, then exports an ad hoc signed app ZIP and logs as Actions artifacts.

**Tech Stack:** GitHub Actions, Xcode, Swift 6, Node 22 from .nvmrc, bash, ditto.

## Global Constraints

- Run existing tests and new native academic-context tests against the exact PR head.
- No real account login, model invocation, submission, messaging or official release publication.
- No signing credentials or repository secrets are required.
- Keep PR #35 a draft until native UI acceptance; CI success is not manual UI acceptance.
- macOS 15 and Apple Silicon test package only; existing Chromium dependency remains separate.
- Preserve the previously delivered broad implementation plan as a local artifact.

## Task 1: Add the cloud workflow

Files: .github/workflows/validate-macos-swiftui.yml.

- [ ] Trigger on relevant pull requests and allow manual dispatch after merge.
- [ ] Use read-only contents permission, bounded runtime and concurrency cancellation.
- [ ] Check out the exact PR head, set up project Node and verify runner architecture.
- [ ] Run npm ci, npm run check and publish scan.
- [ ] Run existing Swift parser/bridge smoke tests and academic-context smoke.
- [ ] Build BXBHomework in Release with full Xcode and bundled Node.
- [ ] Verify the built app's bundled bridge using temporary user data and app.info/session.status.
- [ ] Ad hoc sign, verify and ZIP the app with permissions preserved.
- [ ] Upload app and diagnostic logs separately; app upload only on success.

Validation: parse YAML, run actionlint and bash syntax checks, push to the approved branch, inspect actual Actions job steps and resolve failures from their logs.

## Task 2: Document and execute

Files: apps/macos/swiftui/README.md; docs/implementation/2026-10-06-macos-term-switching.md.

- [ ] Describe artifact download and the distinction between automated checks and UI acceptance.
- [ ] Commit and push the workflow to PR #35.
- [ ] Wait for the cloud run to finish, collect actual pass/fail results and artifact URL.
- [ ] Update PR validation evidence without merging or closing #30.
