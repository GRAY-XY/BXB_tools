# Banxuebang Flutter Desktop

This is a Flutter desktop rewrite of the current Banxuebang shell. It keeps the existing Node client as the data/runtime layer and talks to a bundled `desktop-shell/node_bridge.js` runtime for login, term switching, course selection, task detail, attachment download, and homework submission.

## What is already wired

- Browser login and credential login
- Semester switcher
- Class badge formatting like `G12AP3班`
- Overview dashboard
- Homework list, task detail, attachment download, and submission
- Weekly schedule view

## Runtime contract

The app can run in two layouts:

- development mode inside this repo, where it walks upward to find:
  - `desktop-shell/node_bridge.js`
  - `package.json`
- packaged desktop builds, where the installer bundles a self-contained runtime payload next to the app:
  - macOS: `BXB Student.app/Contents/Resources/app_runtime`
  - Windows: installed app directory root

Packaging scripts live in `packaging/` and reuse the existing user agreement text from `docs/legal/`.

If Flutter is not installed yet in the local environment, you can still keep the source here and generate platform folders later from this directory with Flutter tooling.
