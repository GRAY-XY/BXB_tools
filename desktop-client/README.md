# BXB Client

Desktop and CLI tools for viewing Banxuebang courses, homework, schedule, and notices.

This project logs into the Banxuebang student site with Playwright, extracts the authenticated session, and then requests the platform APIs directly to show:

- courses
- homework
- unsubmitted homework
- weekly schedule
- notices

## Downloads

For normal users, the recommended path is:

1. Open the GitHub repository Releases page
2. Choose the file for your system
3. Download and install it

Recommended release assets:

- macOS: `BXB_Client_macOS_v1.0.0.dmg`
- Windows: `BXB_Client_Setup_Windows.exe`

If both `BXB_Client_macOS_v1.0.0.dmg` and `BXB_Client_macOS.dmg` exist, prefer the versioned file.

More release guidance for maintainers:

- [GitHub Releases](docs/GITHUB_RELEASES.md)

## Apps

This repository currently provides two entry points:

- `banxuebang_gui.py`: Tkinter desktop application
- `banxuebang.py`: command-line interface

## Features

- Cross-platform support for macOS, Windows, and Linux
- GUI desktop client built with Tkinter
- CLI mode for quick queries and scripting
- Course filter support
- Unsubmitted homework highlighting
- Desktop notifications for pending homework
- Basic credential persistence in GUI mode

## Important Notes

- This project depends on the current Banxuebang web login flow and API shape. If the platform changes, the tool may break.
- The GUI stores saved credentials in plain text at `~/.banxuebang_creds.json`. Use with care.
- This is an unofficial tool and is not affiliated with Banxuebang.

## End User Install

### macOS

Use the DMG from GitHub Releases.

Current macOS builds are designed so users do not need to prepare a Python development environment manually.

### Windows

Use the Windows installer from GitHub Releases.

## Developer Setup

### Requirements

- Python 3.10+
- Chromium installed through Playwright for source runs

Install from source:

```bash
python3 -m pip install -U pip
python3 -m pip install -e .
python3 -m playwright install chromium
```

Or without editable install:

```bash
python3 -m pip install -r requirements.txt
python3 -m playwright install chromium
```

## First-Run Launchers

### Windows

```powershell
./start_gui.ps1
./start_cli.ps1 -u your_email@example.com -p your_password
```

### macOS

```bash
chmod +x start_gui.command start_cli.command
./start_gui.command
./start_cli.command -u your_email@example.com -p your_password
```

## Usage

### GUI

```bash
python3 banxuebang_gui.py
```

Or after installing with `pip install -e .`:

```bash
banxuebang-gui
```

### CLI

```bash
python3 banxuebang.py -u your_email@example.com -p your_password
```

Common examples:

```bash
python3 banxuebang.py -u your_email@example.com -p your_password --json
python3 banxuebang.py -u your_email@example.com -p your_password --course 数学
python3 banxuebang.py -u your_email@example.com -p your_password --no-homework
```

## Repository Layout

```text
.
├── README.md
├── LICENSE
├── docs/                   # user and maintainer documentation
├── assets/                 # app icons and UI assets
├── installers/             # simple install/uninstall helpers
├── packaging/              # build, sign, notarization scripts
├── banxuebang.py           # CLI entry point
├── banxuebang_gui.py       # desktop app entry point
├── bootstrap_runtime.py    # runtime bootstrap helper
├── start_gui.command       # macOS launcher for source runs
├── start_gui.ps1           # Windows launcher for source runs
└── pyproject.toml
```

## Docs

- [Docs Index](docs/README.md)
- [Installers](docs/INSTALLERS.md)
- [Packaging](packaging/README.md)
- [Alibaba OAuth Local Test](docs/ALIYUN_OAUTH_LOCAL_TEST.md)

## Development

Quick validation:

```bash
python3 -m py_compile bootstrap_runtime.py banxuebang.py banxuebang_gui.py
```

## License

Released under the MIT License. See [LICENSE](LICENSE).
