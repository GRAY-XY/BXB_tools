from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

import webview

APP_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
ROOT = APP_ROOT
BRIDGE_SCRIPT = ROOT / "desktop-shell" / "node_bridge.js"
HTML_FILE = ROOT / "desktop-shell" / "index.html"
PACKAGE_JSON = ROOT / "package.json"


def get_app_version() -> str:
    try:
        payload = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    except Exception:
        return "1.0.1"
    return str(payload.get("version") or "1.0.1")


def get_node_command() -> str:
    bundled = ROOT / "runtime" / "node"
    if bundled.exists():
        bundled.chmod(bundled.stat().st_mode | 0o111)
        return str(bundled)

    system_node = shutil.which("node")
    if system_node:
        return system_node

    raise RuntimeError("Node.js runtime is missing. Install Node.js or use the packaged desktop build.")


def build_runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    browsers_path = prepare_playwright_browsers()
    if browsers_path.exists():
        env["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_path)
    return env


def prepare_playwright_browsers() -> Path:
    bundled_dir = ROOT / "runtime" / "ms-playwright"
    if bundled_dir.exists():
        return bundled_dir

    bundled_archive = ROOT / "runtime" / "ms-playwright.tar.gz"
    if not bundled_archive.exists():
        return bundled_dir

    target_root = Path.home() / "Library" / "Application Support" / "BXB Student" / "runtime"
    target_dir = target_root / "ms-playwright"
    if target_dir.exists():
        return target_dir

    target_root.mkdir(parents=True, exist_ok=True)
    with tarfile.open(bundled_archive, "r:gz") as archive:
        archive.extractall(target_root)
    return target_dir


class DesktopApi:
    def __init__(self) -> None:
        self.window: webview.Window | None = None
        self.node_command = get_node_command()
        self.runtime_env = build_runtime_env()

    def attach_window(self, window: webview.Window) -> None:
        self.window = window

    def _run_bridge(self, command: str, payload: dict | None = None) -> dict:
        raw_payload = json.dumps(payload or {}, ensure_ascii=False)
        result = subprocess.run(
            [self.node_command, str(BRIDGE_SCRIPT), command, raw_payload],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=self.runtime_env,
        )

        stdout = (result.stdout or "").strip()
        if stdout:
            try:
                parsed = json.loads(stdout)
            except json.JSONDecodeError:
                parsed = {"ok": False, "error": stdout}
        else:
            parsed = {"ok": False, "error": result.stderr.strip() or f"Bridge command failed: {command}"}

        if result.returncode != 0 and parsed.get("ok") is not False:
            return {"ok": False, "error": result.stderr.strip() or f"Bridge command failed: {command}"}

        return parsed

    def load_dashboard(self) -> dict:
        return self._run_bridge("dashboard")

    def login(self) -> dict:
        return self._run_bridge("login")

    def login_with_credentials(self, username: str, password: str) -> dict:
        return self._run_bridge(
            "login-with-credentials",
            {
                "username": username,
                "password": password,
            },
        )

    def logout(self) -> dict:
        return self._run_bridge("logout")

    def set_subject(self, subject_name: str) -> dict:
        return self._run_bridge("set-subject", {"subjectName": subject_name})

    def open_task(self, task_id: str) -> dict:
        return self._run_bridge("open-task", {"taskId": task_id})

    def submit_task(self, payload: dict) -> dict:
        return self._run_bridge("submit-task", payload or {})

    def pick_files(self) -> dict:
        if not self.window:
            return {"canceled": True, "filePaths": []}

        selection = self.window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True)
        return {
            "canceled": not bool(selection),
            "filePaths": list(selection or []),
        }

    def open_external(self, url: str) -> bool:
        import webbrowser

        return webbrowser.open(url)


def ensure_runtime_ready() -> None:
    node_modules = ROOT / "node_modules"
    if not node_modules.exists():
        if getattr(sys, "frozen", False):
            raise RuntimeError("Bundled desktop build is incomplete: node_modules is missing.")
        subprocess.check_call(["npm", "install"], cwd=ROOT)


def main() -> int:
    ensure_runtime_ready()
    api = DesktopApi()
    window = webview.create_window(
        f"BXB Student {get_app_version()}",
        HTML_FILE.as_uri(),
        js_api=api,
        width=1440,
        height=920,
        min_size=(1180, 760),
        background_color="#D8E2EF",
        text_select=True,
    )
    api.attach_window(window)
    def _mark_runtime() -> None:
        try:
            window.evaluate_js("window.__BXB_DESKTOP_RUNTIME__ = 'pywebview';")
        except Exception:
            pass

    webview.start(_mark_runtime, debug=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
