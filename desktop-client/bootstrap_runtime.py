#!/usr/bin/env python3
"""
Shared runtime bootstrap for Banxuebang tools.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = PROJECT_ROOT / "bootstrap_config.json"


class RuntimeBootstrapError(RuntimeError):
    """Raised when runtime bootstrap fails."""


def _load_config() -> dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def detect_platform() -> str:
    current = sys.platform
    if current.startswith("win"):
        return "windows"
    if current == "darwin":
        return "darwin"
    return "linux"


def _runtime_record_path(config: dict[str, Any]) -> Path:
    filename = config.get("runtime_record", {}).get("filename", ".banxuebang_runtime.json")
    return Path.home() / filename


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split(".") if part.isdigit())


def ensure_supported_python(config: dict[str, Any]) -> None:
    required = config.get("required_python", "3.10")
    if sys.version_info < _version_tuple(required):
        raise RuntimeBootstrapError(
            f"Python {required}+ is required, current version is "
            f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}."
        )


def _run(command: list[str], description: str) -> None:
    try:
        subprocess.check_call(command)
    except subprocess.CalledProcessError as exc:
        joined = " ".join(command)
        raise RuntimeBootstrapError(f"{description} failed: {joined}") from exc


def ensure_pip() -> None:
    try:
        import pip  # noqa: F401
    except ImportError:
        _run([sys.executable, "-m", "ensurepip", "--upgrade"], "Bootstrapping pip")


def _in_virtualenv() -> bool:
    return (
        getattr(sys, "base_prefix", sys.prefix) != sys.prefix
        or hasattr(sys, "real_prefix")
        or bool(os.environ.get("VIRTUAL_ENV"))
    )


def _pip_install_command(spec: str) -> list[str]:
    command = [sys.executable, "-m", "pip", "install"]
    if not _in_virtualenv():
        command.append("--user")
        command.append("--break-system-packages")
    command.append(spec)
    return command


def _package_specs(config: dict[str, Any]) -> list[dict[str, str]]:
    platform_key = detect_platform()
    packages = list(config.get("packages", {}).get("common", []))
    packages.extend(config.get("packages", {}).get(platform_key, []))
    return packages


def ensure_python_packages(config: dict[str, Any]) -> list[str]:
    installed: list[str] = []
    for package in _package_specs(config):
        module_name = package["module"]
        pip_spec = package["pip"]
        try:
            importlib.import_module(module_name)
        except ImportError:
            _run(_pip_install_command(pip_spec), f"Installing {pip_spec}")
            installed.append(pip_spec)
    return installed


def _playwright_missing(browser_name: str) -> bool:
    from playwright.sync_api import Error, sync_playwright

    with sync_playwright() as pw:
        browser_type = getattr(pw, browser_name)
        try:
            browser = browser_type.launch(headless=True)
        except Error:
            return True
        else:
            browser.close()
            return False


def ensure_playwright_browsers(config: dict[str, Any]) -> list[str]:
    browsers = config.get("playwright", {}).get("browsers", [])
    installed: list[str] = []
    if not browsers:
        return installed

    from playwright.sync_api import Error  # noqa: F401

    for browser_name in browsers:
        if _playwright_missing(browser_name):
            _run(
                [sys.executable, "-m", "playwright", "install", browser_name],
                f"Installing Playwright browser {browser_name}",
            )
            installed.append(browser_name)
    return installed


def verify_gui_support() -> None:
    try:
        import tkinter  # noqa: F401
    except ImportError as exc:
        raise RuntimeBootstrapError("Tkinter is unavailable in this Python installation.") from exc


def runtime_is_ready(mode: str = "gui") -> bool:
    config = _load_config()
    try:
        ensure_supported_python(config)
        import pip  # noqa: F401
        for package in _package_specs(config):
            importlib.import_module(package["module"])
        for browser_name in config.get("playwright", {}).get("browsers", []):
            if _playwright_missing(browser_name):
                return False
        if mode == "gui":
            verify_gui_support()
    except Exception:
        return False
    return True


def write_runtime_record(config: dict[str, Any], *, mode: str, packages: list[str], browsers: list[str]) -> Path:
    record_path = _runtime_record_path(config)
    payload = {
        "mode": mode,
        "platform": detect_platform(),
        "python_executable": sys.executable,
        "python_version": platform.python_version(),
        "packages_installed": packages,
        "playwright_browsers_installed": browsers,
        "project_root": str(PROJECT_ROOT),
    }
    with record_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    return record_path


def ensure_runtime(mode: str = "gui") -> Path:
    config = _load_config()
    ensure_supported_python(config)
    ensure_pip()
    packages = ensure_python_packages(config)
    browsers = ensure_playwright_browsers(config)
    if mode == "gui":
        verify_gui_support()
    return write_runtime_record(config, mode=mode, packages=packages, browsers=browsers)


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap runtime dependencies for Banxuebang.")
    parser.add_argument("--mode", choices=["gui", "cli"], default="gui")
    parser.add_argument("--check-only", action="store_true", help="Exit 0 when runtime is ready, otherwise exit 1.")
    args = parser.parse_args()

    if args.check_only:
        return 0 if runtime_is_ready(mode=args.mode) else 1

    try:
        record_path = ensure_runtime(mode=args.mode)
    except RuntimeBootstrapError as exc:
        print(f"Runtime bootstrap failed: {exc}", file=sys.stderr)
        return 1

    print(f"Runtime bootstrap complete. Record written to {record_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
