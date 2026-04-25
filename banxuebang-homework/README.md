# Banxuebang Homework Helper

Desktop and CLI tools for viewing Banxuebang courses, homework, schedule, and notices.

This project logs into the Banxuebang student site with Playwright, extracts the authenticated session, and then requests the platform APIs directly to show:

- courses
- homework
- unsubmitted homework
- weekly schedule
- notices

It currently provides two entry points:

- `banxuebang.py`: command-line interface
- `banxuebang_gui.py`: Tkinter desktop application

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
- The GUI currently stores saved credentials in plain text at `~/.banxuebang_creds.json`. Use with care.
- This is an unofficial tool and is not affiliated with Banxuebang.

## Requirements

- Python 3.10+
- Chromium installed through Playwright

## Installation

```bash
python3 -m pip install -U pip
python3 -m pip install -e .
python3 -m playwright install chromium
```

If you prefer not to install the package in editable mode:

```bash
python3 -m pip install -r requirements.txt
python3 -m playwright install chromium
```

## Usage

### GUI

```bash
python3 banxuebang_gui.py
```

Or, after installing with `pip install -e .`:

```bash
banxuebang-gui
```

### CLI

```bash
python3 banxuebang.py -u your_email@example.com -p your_password
```

Common options:

```bash
python3 banxuebang.py -u your_email@example.com -p your_password --json
python3 banxuebang.py -u your_email@example.com -p your_password --course 数学
python3 banxuebang.py -u your_email@example.com -p your_password --no-homework
```

Or, after installing with `pip install -e .`:

```bash
banxuebang-cli -u your_email@example.com -p your_password
```

## Project Structure

```text
.
├── banxuebang.py          # CLI entry point
├── banxuebang_gui.py      # Tkinter desktop app
├── requirements.txt       # Runtime dependencies
├── pyproject.toml         # Packaging and project metadata
├── LICENSE                # Open-source license
└── .github/workflows/ci.yml
```

## Development

Quick validation:

```bash
python3 -m py_compile banxuebang.py banxuebang_gui.py
```

## Contributing

Issues and pull requests are welcome. Please include:

- your operating system
- Python version
- whether the issue happens in CLI or GUI mode
- the relevant error message or traceback

## License

Released under the MIT License. See [LICENSE](LICENSE).
