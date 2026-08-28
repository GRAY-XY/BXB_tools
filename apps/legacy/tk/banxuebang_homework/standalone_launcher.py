from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tkinter as tk
import traceback
from tkinter import messagebox, ttk
import zipfile
import ttkbootstrap as ttkb

from apps.legacy.tk.banxuebang_homework.backend_factory import create_backend
from apps.legacy.tk.banxuebang_homework.tk_app import HomeworkUiApp


APP_NAME = "BXB Homework UI"
PAYLOAD_VERSION = "standalone-2026-06-28-frontend-backend"
NODE_DIST = "node-v22.15.0-win-x64"
NODE_ZIP_NAME = f"{NODE_DIST}.zip"
BROWSER_ARCHIVE_NAME = "ms-playwright-browsers.zip"
BROWSER_RUNTIME_DIR = "ms-playwright"


class BootstrapWindow:
    def __init__(self) -> None:
        self.root = ttkb.Window(themename="litera")
        self.root.title(APP_NAME)
        self.root.geometry("560x180")
        self.root.resizable(False, False)
        self.root.configure(bg="#162030")
        self.status_var = tk.StringVar(value="Preparing runtime...")
        self.detail_var = tk.StringVar(value="")

        shell = tk.Frame(self.root, bg="#162030", padx=18, pady=18)
        shell.pack(fill="both", expand=True)

        tk.Label(
            shell,
            text=APP_NAME,
            bg="#162030",
            fg="#edf4ff",
            font=("Segoe UI Semibold", 18),
            anchor="w",
        ).pack(fill="x")
        tk.Label(
            shell,
            textvariable=self.status_var,
            bg="#162030",
            fg="#d9e4f7",
            font=("Segoe UI", 11),
            anchor="w",
            justify="left",
        ).pack(fill="x", pady=(12, 8))
        tk.Label(
            shell,
            textvariable=self.detail_var,
            bg="#162030",
            fg="#9fb0c8",
            font=("Consolas", 10),
            anchor="w",
            justify="left",
            wraplength=510,
        ).pack(fill="x")

        self.progress = ttk.Progressbar(shell, mode="indeterminate")
        self.progress.pack(fill="x", pady=(18, 0))
        self.progress.start(12)
        self.root.update_idletasks()

    def set_status(self, status: str, detail: str | None = None) -> None:
        self.status_var.set(status)
        if detail is not None:
            self.detail_var.set(detail)
        _log(f"[status] {status} :: {detail or ''}")
        self.root.update_idletasks()
        self.root.update()

    def close(self) -> None:
        try:
            self.progress.stop()
        except Exception:
            pass
        self.root.destroy()

    def handoff(self) -> None:
        try:
            self.progress.stop()
        except Exception:
            pass
        for child in list(self.root.winfo_children()):
            child.destroy()
        self.root.configure(bg="#162030")
        self.root.update_idletasks()


def _local_app_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "BXBHomeworkUI"
    return Path.home() / "AppData" / "Local" / "BXBHomeworkUI"


def _log_file() -> Path:
    return _local_app_root() / "logs" / "launcher.log"


def _log(message: str) -> None:
    try:
        target = _log_file()
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(f"{message}\n")
    except Exception:
        pass


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _resource_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "payload"
    return _repo_root()


def _node_zip_source() -> Path | None:
    candidate = _resource_root() / "runtime" / NODE_ZIP_NAME
    return candidate if candidate.exists() else None


def _browser_zip_source() -> Path | None:
    candidate = _resource_root() / "runtime" / BROWSER_ARCHIVE_NAME
    return candidate if candidate.exists() else None


def _payload_target_root() -> Path:
    return _local_app_root() / "app"


def _runtime_root() -> Path:
    return _local_app_root() / "runtime"


def _bundled_browser_root() -> Path:
    return _runtime_root() / BROWSER_RUNTIME_DIR


def _payload_version_file(target_root: Path) -> Path:
    return target_root / ".payload-version"


def _copy_payload(status: BootstrapWindow) -> Path:
    if not getattr(sys, "frozen", False):
        repo_root = _repo_root()
        status.set_status("Using source checkout.", str(repo_root))
        return repo_root

    source_root = _resource_root()
    target_root = _payload_target_root()
    version_file = _payload_version_file(target_root)
    current_version = version_file.read_text(encoding="utf-8").strip() if version_file.exists() else None

    if current_version == PAYLOAD_VERSION and (target_root / "backend" / "src").exists() and (target_root / "backend" / "cli").exists():
        status.set_status("Runtime payload is ready.", str(target_root))
        return target_root

    status.set_status("Preparing application files...", str(target_root))
    if target_root.exists():
        shutil.rmtree(target_root, ignore_errors=True)
    target_root.mkdir(parents=True, exist_ok=True)

    for relative in ("backend", "node_modules", "package.json", "package-lock.json", "README.md"):
        source = source_root / relative
        target = target_root / relative
        if not source.exists():
            continue
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

    version_file.write_text(PAYLOAD_VERSION, encoding="utf-8")
    return target_root


def _ensure_node_runtime(status: BootstrapWindow) -> Path:
    if not getattr(sys, "frozen", False):
        status.set_status("Using system Node runtime.", "node")
        return Path("node")

    runtime_root = _runtime_root()
    node_root = runtime_root / NODE_DIST
    node_exe = node_root / "node.exe"
    if node_exe.exists():
        status.set_status("Node runtime is ready.", str(node_exe))
        return node_exe

    node_zip = _node_zip_source()
    if node_zip is None:
        raise RuntimeError(f"Bundled Node runtime archive is missing: {NODE_ZIP_NAME}")

    status.set_status("Extracting bundled Node runtime...", NODE_ZIP_NAME)
    runtime_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(node_zip) as archive:
        archive.extractall(runtime_root)

    if not node_exe.exists():
        raise RuntimeError("Node runtime extraction finished, but node.exe was not found.")
    return node_exe


def _has_playwright_browser(root: Path) -> bool:
    if not root.exists():
        return False

    for candidate in root.glob("chromium-*"):
        if (candidate / "chrome-win" / "chrome.exe").exists():
            return True
        if (candidate / "chrome-win64" / "chrome.exe").exists():
            return True
    return False


def _extract_browser_archive(status: BootstrapWindow, archive_path: Path, browsers_root: Path) -> bool:
    status.set_status("Extracting bundled browser...", archive_path.name)
    if browsers_root.exists():
        shutil.rmtree(browsers_root, ignore_errors=True)
    browsers_root.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(browsers_root)

    return _has_playwright_browser(browsers_root)


def _ensure_playwright_browser(status: BootstrapWindow, app_root: Path, node_exe: Path) -> None:
    if not getattr(sys, "frozen", False):
        status.set_status("Source mode detected.", "Skipping bundled browser bootstrap.")
        return

    browsers_root = _bundled_browser_root()
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_root)
    os.environ["PLAYWRIGHT_SKIP_BROWSER_GC"] = "1"

    if _has_playwright_browser(browsers_root):
        status.set_status("Browser dependency is already installed.", str(browsers_root))
        return

    browser_zip = _browser_zip_source()
    if browser_zip and _extract_browser_archive(status, browser_zip, browsers_root):
        status.set_status("Bundled browser is ready.", str(browsers_root))
        return

    status.set_status("Installing browser dependency...", "This may take a few minutes on first launch.")
    command = [
        str(node_exe),
        str(app_root / "node_modules" / "playwright" / "cli.js"),
        "install",
        "chromium",
    ]
    startupinfo = None
    creationflags = 0
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = 0
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    install_env = os.environ.copy()
    result = subprocess.run(
        command,
        cwd=app_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=install_env,
        startupinfo=startupinfo,
        creationflags=creationflags,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"Failed to install Chromium for Playwright.\n{detail}")

    if not _has_playwright_browser(browsers_root):
        raise RuntimeError("Chromium installation completed, but no Playwright browser payload was found.")


def launch() -> None:
    status = BootstrapWindow()
    try:
        _log("[launch] start")
        app_root = _copy_payload(status)
        _log(f"[launch] payload_root={app_root}")
        node_exe = _ensure_node_runtime(status)
        _log(f"[launch] node_exe={node_exe}")
        _ensure_playwright_browser(status, app_root, node_exe)
        _log("[launch] playwright-ready")
        status.set_status("Launching application...", str(app_root))
        status.handoff()
        backend = create_backend(
            backend_name="direct-tool",
            repo_root=app_root,
            node_command=str(node_exe),
        )
        _log("[launch] ui-start")
        HomeworkUiApp(status.root, backend=backend)
        status.root.mainloop()
    except Exception as error:  # noqa: BLE001
        _log("[launch] error")
        _log(traceback.format_exc())
        try:
            status.close()
        except Exception:
            pass
        messagebox.showerror(APP_NAME, f"{error}\n\n详细日志：{_log_file()}")


if __name__ == "__main__":
    launch()
