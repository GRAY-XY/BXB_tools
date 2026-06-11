from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import tarfile
import traceback
from datetime import datetime, timezone
import urllib.error
import urllib.request
import base64
from pathlib import Path
from urllib.parse import urlparse

import webview

APP_NAME = "BXB Student"
APP_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
ROOT = APP_ROOT
BRIDGE_SCRIPT = ROOT / "desktop-shell" / "node_bridge.js"
HTML_FILE = ROOT / "desktop-shell" / "index.html"
PACKAGE_JSON = ROOT / "package.json"
DOCS_ROOT = ROOT / "docs"
REPO_RELEASES_URL = "https://github.com/GRAY-XY/BXB_tools/releases"
REPO_LATEST_RELEASE_API = "https://api.github.com/repos/GRAY-XY/BXB_tools/releases/latest"
REPO_OWNER = "GRAY-XY"
REPO_NAME = "BXB_tools"
REPO_REF = os.environ.get("BXB_GITHUB_REF", "client")
POLICY_REMOTE_URL = f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{REPO_REF}/config/desktop-policy.json"
REGISTRY_CONTENTS_API = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents/data/user-registry.json"
LOCAL_POLICY_FILE = ROOT / "config" / "desktop-policy.json"


def get_platform_name() -> str:
    if sys.platform == "darwin":
        return "macOS"
    if sys.platform.startswith("win"):
        return "Windows"
    return sys.platform


def get_app_support_dir() -> Path:
    override = os.environ.get("BANXUEBANG_APP_SUPPORT_DIR")
    if override:
        return Path(override).expanduser()

    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME

    if sys.platform.startswith("win"):
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / APP_NAME
        return Path.home() / "AppData" / "Roaming" / APP_NAME

    xdg_config = os.environ.get("XDG_CONFIG_HOME")
    if xdg_config:
        return Path(xdg_config) / APP_NAME
    return Path.home() / ".config" / APP_NAME


def get_downloads_dir() -> Path:
    override = os.environ.get("BANXUEBANG_DOWNLOADS_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / "Downloads" / APP_NAME


def get_runtime_root() -> Path:
    return get_app_support_dir() / "runtime"


APP_SUPPORT_DIR = get_app_support_dir()
DOWNLOADS_DIR = get_downloads_dir()
LOGS_DIR = APP_SUPPORT_DIR / "logs"
LOG_FILE = LOGS_DIR / "desktop-shell.log"
LOCAL_REGISTRY_CACHE = APP_SUPPORT_DIR / "user-registry-cache.json"
LOCAL_PENDING_REGISTRY = APP_SUPPORT_DIR / "user-registry-pending.json"


def configure_logging() -> logging.Logger:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("bxb-desktop")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logger.addHandler(handler)
    return logger


LOGGER = configure_logging()


def get_app_version() -> str:
    try:
        payload = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    except Exception:
        return "1.0.2"
    return str(payload.get("version") or "1.0.2")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def compare_versions(current: str, latest: str) -> int:
    def parse(version: str) -> tuple[int, ...]:
        cleaned = str(version).strip().lstrip("vV")
        parts = []
        for part in cleaned.split("."):
            try:
                parts.append(int(part))
            except ValueError:
                digits = "".join(char for char in part if char.isdigit())
                parts.append(int(digits) if digits else 0)
        return tuple(parts)

    current_parts = parse(current)
    latest_parts = parse(latest)
    max_len = max(len(current_parts), len(latest_parts))
    padded_current = current_parts + (0,) * (max_len - len(current_parts))
    padded_latest = latest_parts + (0,) * (max_len - len(latest_parts))
    if padded_current < padded_latest:
        return -1
    if padded_current > padded_latest:
        return 1
    return 0


def resolve_doc_path(*parts: str) -> str | None:
    candidate = DOCS_ROOT.joinpath(*parts)
    if candidate.exists():
        return str(candidate.resolve())
    return None


def read_json_file(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json_file(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def get_registry_token() -> str | None:
    token = os.environ.get("BXB_GITHUB_REGISTRY_TOKEN")
    if token:
        return token.strip()
    gh_path = shutil.which("gh")
    if not gh_path:
        return None
    try:
        result = subprocess.run(
            [gh_path, "auth", "token"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=5,
            check=False,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    value = (result.stdout or "").strip()
    return value or None


def get_default_policy() -> dict:
    return {
        "version": 1,
        "enforcementEnabled": True,
        "registrationEnabled": True,
        "lockMessage": "当前软件已被管理员暂时锁定，请联系维护者。",
        "blockedUserIds": [],
        "blockedEmails": [],
        "blockedNames": [],
        "minimumSupportedVersion": "1.0.1",
    }


def load_policy() -> dict:
    policy = get_default_policy()
    local_payload = read_json_file(LOCAL_POLICY_FILE, {})
    if isinstance(local_payload, dict):
        policy.update(local_payload)

    request = urllib.request.Request(
        POLICY_REMOTE_URL,
        headers={
            "Accept": "application/json",
            "User-Agent": "BXB-Student-Desktop",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=6) as response:
            remote_payload = json.loads(response.read().decode("utf-8"))
        if isinstance(remote_payload, dict):
            policy.update(remote_payload)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            LOGGER.warning("policy fetch failed: %s", error)
    except Exception as error:
        LOGGER.warning("policy fetch failed: %s", error)

    return policy


def evaluate_policy(summary: dict | None, policy: dict | None = None) -> dict:
    policy = policy or load_policy()
    minimum_supported_version = str(policy.get("minimumSupportedVersion") or get_app_version())
    access = {
        "locked": False,
        "reason": "",
        "minimumSupportedVersion": minimum_supported_version,
        "policySource": POLICY_REMOTE_URL,
        "registrationEnabled": bool(policy.get("registrationEnabled", True)),
    }

    if compare_versions(get_app_version(), minimum_supported_version) < 0:
        access["locked"] = True
        access["reason"] = f"当前版本过旧，请升级到 v{minimum_supported_version} 或更高版本。"
        return access

    # 全局锁：无论谁登录都锁死
    if bool(policy.get("globalLock", False)):
        access["locked"] = True
        access["reason"] = str(policy.get("lockMessage") or "服务当前已被管理员暂停，请稍后再试。")
        return access

    if not summary or not summary.get("ready"):
        return access

    if not bool(policy.get("enforcementEnabled", True)):
        return access

    user = summary.get("user") or {}
    user_id = str(user.get("id") or "").strip()
    email = str(user.get("loginName") or "").strip().lower()
    name = str(user.get("name") or "").strip()

    blocked_user_ids = {str(item).strip() for item in policy.get("blockedUserIds", []) if str(item).strip()}
    blocked_emails = {str(item).strip().lower() for item in policy.get("blockedEmails", []) if str(item).strip()}
    blocked_names = {str(item).strip() for item in policy.get("blockedNames", []) if str(item).strip()}

    if user_id and user_id in blocked_user_ids:
        access["locked"] = True
    elif email and email in blocked_emails:
        access["locked"] = True
    elif name and name in blocked_names:
        access["locked"] = True

    if access["locked"]:
        access["reason"] = str(policy.get("lockMessage") or "检测到当前账号已被管理员限制使用。")
    return access


def upsert_registry_record(summary: dict) -> dict | None:
    if not summary.get("ready") or not summary.get("user"):
        return None
    user = summary["user"]
    email = str(user.get("loginName") or "").strip()
    if not email:
        return None
    return {
        "userId": str(user.get("id") or ""),
        "name": str(user.get("name") or ""),
        "email": email,
        "platform": get_platform_name(),
        "appVersion": get_app_version(),
        "lastSeenAt": now_iso(),
    }


def merge_registry(records: list[dict], new_record: dict) -> list[dict]:
    now = new_record["lastSeenAt"]
    updated = False
    merged: list[dict] = []
    for item in records:
        if str(item.get("email") or "").strip().lower() == new_record["email"].strip().lower():
            merged.append(
                {
                    **item,
                    **new_record,
                    "firstSeenAt": item.get("firstSeenAt") or now,
                    "lastSeenAt": now,
                }
            )
            updated = True
        else:
            merged.append(item)
    if not updated:
        merged.append({**new_record, "firstSeenAt": now})
    merged.sort(key=lambda item: str(item.get("lastSeenAt") or ""), reverse=True)
    return merged


def update_local_registry_cache(new_record: dict) -> list[dict]:
    current = read_json_file(LOCAL_REGISTRY_CACHE, [])
    records = current if isinstance(current, list) else []
    merged = merge_registry(records, new_record)
    write_json_file(LOCAL_REGISTRY_CACHE, merged)
    return merged


def write_pending_registry(new_record: dict) -> None:
    current = read_json_file(LOCAL_PENDING_REGISTRY, [])
    records = current if isinstance(current, list) else []
    merged = merge_registry(records, new_record)
    write_json_file(LOCAL_PENDING_REGISTRY, merged)


def sync_registry_to_github(new_record: dict) -> dict:
    token = get_registry_token()
    if not token:
        write_pending_registry(new_record)
        return {"enabled": False, "synced": False, "reason": "missing-token"}

    get_request = urllib.request.Request(
        REGISTRY_CONTENTS_API,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "BXB-Student-Desktop",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )

    sha = None
    existing_records: list[dict] = []
    try:
        with urllib.request.urlopen(get_request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        sha = payload.get("sha")
        content = payload.get("content") or ""
        if content:
            decoded = base64.b64decode(content).decode("utf-8")
            parsed = json.loads(decoded)
            if isinstance(parsed, list):
                existing_records = parsed
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise

    merged = merge_registry(existing_records, new_record)
    encoded = base64.b64encode((json.dumps(merged, ensure_ascii=False, indent=2) + "\n").encode("utf-8")).decode("utf-8")
    body = {
        "message": f"Update desktop user registry for {new_record['email']}",
        "content": encoded,
        "branch": REPO_REF,
    }
    if sha:
        body["sha"] = sha

    put_request = urllib.request.Request(
        REGISTRY_CONTENTS_API,
        data=json.dumps(body).encode("utf-8"),
        method="PUT",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "BXB-Student-Desktop",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(put_request, timeout=10):
        pass
    if LOCAL_PENDING_REGISTRY.exists():
        LOCAL_PENDING_REGISTRY.unlink(missing_ok=True)
    return {"enabled": True, "synced": True, "reason": "ok"}


def get_support_payload() -> dict:
    agreement_path = resolve_doc_path("legal", "BXB_Student_User_Agreement_zh-CN.md")
    privacy_path = resolve_doc_path("legal", "BXB_Student_Privacy_Notice_zh-CN.md")
    release_notes_path = resolve_doc_path("releases", f"{get_app_version()}.md")
    return {
        "appName": APP_NAME,
        "version": get_app_version(),
        "platform": get_platform_name(),
        "downloadsDir": str(DOWNLOADS_DIR),
        "logsDir": str(LOGS_DIR),
        "releaseNotesPath": release_notes_path,
        "agreementPath": agreement_path,
        "privacyPath": privacy_path,
        "releaseUrl": REPO_RELEASES_URL,
        "githubUrl": "https://github.com/GRAY-XY/BXB_tools",
        "email": "igpig1226@gmail.com",
        "policyUrl": POLICY_REMOTE_URL,
        "registryCachePath": str(LOCAL_REGISTRY_CACHE),
    }


def check_latest_release() -> dict:
    request = urllib.request.Request(
        REPO_LATEST_RELEASE_API,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "BXB-Student-Desktop",
        },
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode("utf-8"))
    latest_version = str(payload.get("tag_name") or "").lstrip("vV") or get_app_version()
    return {
        "currentVersion": get_app_version(),
        "latestVersion": latest_version,
        "hasUpdate": compare_versions(get_app_version(), latest_version) < 0,
        "releaseName": payload.get("name") or payload.get("tag_name") or latest_version,
        "releaseUrl": payload.get("html_url") or REPO_RELEASES_URL,
        "publishedAt": payload.get("published_at"),
        "body": payload.get("body") or "",
    }


def get_node_command() -> str:
    bundled_candidates = [
        ROOT / "runtime" / "node.exe",
        ROOT / "runtime" / "node",
    ]
    for bundled in bundled_candidates:
        if bundled.exists():
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
    env["BANXUEBANG_APP_SUPPORT_DIR"] = str(APP_SUPPORT_DIR)
    env["BANXUEBANG_SESSION_FILE"] = str(APP_SUPPORT_DIR / ".banxuebang" / "session.json")
    return env


def prepare_playwright_browsers() -> Path:
    bundled_dir = ROOT / "runtime" / "ms-playwright"
    if bundled_dir.exists():
        return bundled_dir

    bundled_archive = ROOT / "runtime" / "ms-playwright.tar.gz"
    if not bundled_archive.exists():
        return bundled_dir

    target_root = get_runtime_root()
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
        self.policy = load_policy()

    def attach_window(self, window: webview.Window) -> None:
        self.window = window

    def _run_bridge(self, command: str, payload: dict | None = None) -> dict:
        raw_payload = json.dumps(payload or {}, ensure_ascii=False)
        LOGGER.info("bridge start command=%s", command)
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
            LOGGER.error("bridge failed command=%s stderr=%s", command, result.stderr.strip())
            return {"ok": False, "error": result.stderr.strip() or f"Bridge command failed: {command}"}

        if parsed.get("ok") is False:
            LOGGER.error("bridge error command=%s message=%s", command, parsed.get("error"))
        else:
            LOGGER.info("bridge success command=%s", command)
        return parsed

    def load_dashboard(self) -> dict:
        result = self._run_bridge("dashboard")
        return self._post_process_dashboard(result)

    def login(self) -> dict:
        result = self._run_bridge("login")
        return self._post_process_dashboard(result, clear_session_on_lock=True, should_register=True)

    def login_with_credentials(self, username: str, password: str) -> dict:
        result = self._run_bridge(
            "login-with-credentials",
            {
                "username": username,
                "password": password,
            },
        )
        return self._post_process_dashboard(result, clear_session_on_lock=True, should_register=True)

    def logout(self) -> dict:
        return self._run_bridge("logout")

    def set_term(self, term_id: str) -> dict:
        result = self._run_bridge("set-term", {"termId": term_id})
        return self._post_process_dashboard(result)

    def _post_process_dashboard(
        self,
        result: dict,
        clear_session_on_lock: bool = False,
        should_register: bool = False,
    ) -> dict:
        if not result.get("ok") or not isinstance(result.get("data"), dict):
            return result

        dashboard = result["data"]
        session_summary = dashboard.get("session") or {}
        self.policy = load_policy()
        access = evaluate_policy(session_summary, self.policy)
        dashboard["access"] = access

        if should_register and session_summary.get("ready") and access.get("registrationEnabled"):
            record = upsert_registry_record(session_summary)
            if record:
                try:
                    update_local_registry_cache(record)
                    dashboard["registry"] = sync_registry_to_github(record)
                except Exception as error:
                    LOGGER.warning("registry sync failed: %s", error)
                    write_pending_registry(record)
                    dashboard["registry"] = {"enabled": False, "synced": False, "reason": str(error)}

        if access.get("locked"):
            LOGGER.warning("access locked for user=%s", (session_summary.get("user") or {}).get("loginName"))
            if clear_session_on_lock:
                self._run_bridge("logout")
            dashboard["session"] = {
                **session_summary,
                "ready": False,
            }

        return {"ok": True, "data": dashboard}

    def set_subject(self, subject_name: str) -> dict:
        return self._run_bridge("set-subject", {"subjectName": subject_name})

    def open_task(self, task_id: str) -> dict:
        return self._run_bridge("open-task", {"taskId": task_id})

    def submit_task(self, payload: dict) -> dict:
        return self._run_bridge("submit-task", payload or {})

    def download_attachment(self, task_id: str, file_id: str) -> dict:
        result = self._run_bridge(
            "download-attachment",
            {
                "taskId": task_id,
                "fileId": file_id,
                "directory": str(DOWNLOADS_DIR),
            },
        )
        if result.get("ok") and isinstance(result.get("data"), dict):
            file_path = result["data"].get("path")
            if file_path:
                result["data"]["uri"] = Path(file_path).resolve().as_uri()
        return result

    def pick_files(self) -> dict:
        if not self.window:
            return {"canceled": True, "filePaths": []}

        selection = self.window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True)
        return {
            "canceled": not bool(selection),
            "filePaths": list(selection or []),
        }

    def pick_background_image(self) -> dict:
        if not self.window:
            return {"canceled": True, "filePath": None}

        selection = self.window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=("Image files (*.png;*.jpg;*.jpeg;*.webp)",),
        )
        file_path = selection[0] if selection else None
        return {
            "canceled": not bool(file_path),
            "filePath": file_path,
        }

    def get_app_meta(self) -> dict:
        return ok(get_support_payload())

    def check_for_updates(self) -> dict:
        try:
            return ok(check_latest_release())
        except urllib.error.URLError as error:
            LOGGER.warning("update check failed: %s", error)
            return {"ok": False, "error": "暂时无法检查更新，请稍后再试。"}
        except Exception as error:
            LOGGER.exception("unexpected update-check failure")
            return {"ok": False, "error": f"检查更新失败：{error}"}

    def uninstall_app(self) -> dict:
        """Remove app support data and ask the user to delete the app bundle themselves."""
        import shutil as _shutil
        removed: list[str] = []
        errors: list[str] = []

        for target in [APP_SUPPORT_DIR]:
            try:
                if target.exists():
                    _shutil.rmtree(target, ignore_errors=True)
                    removed.append(str(target))
            except Exception as exc:
                errors.append(f"{target}: {exc}")

        LOGGER.info("uninstall: removed=%s errors=%s", removed, errors)
        return ok({
            "removed": removed,
            "errors": errors,
            "note": "应用数据已清除。请手动将应用程序移到废纸篓以完成卸载。",
        })

    def reveal_path(self, target_path: str) -> bool:
        candidate = Path(target_path).expanduser()
        if not candidate.exists():
            candidate.mkdir(parents=True, exist_ok=True)
        return self.open_external(str(candidate))

    def open_external(self, url: str) -> bool:
        import webbrowser

        parsed = urlparse(url)
        if parsed.scheme:
            return webbrowser.open(url)

        candidate = Path(url).expanduser()
        if candidate.exists():
            return webbrowser.open(candidate.resolve().as_uri())

        return webbrowser.open(url)


def ok(data) -> dict:
    return {"ok": True, "data": data}


def ensure_runtime_ready() -> None:
    APP_SUPPORT_DIR.mkdir(parents=True, exist_ok=True)
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    node_modules = ROOT / "node_modules"
    if not node_modules.exists():
        if getattr(sys, "frozen", False):
            raise RuntimeError("Bundled desktop build is incomplete: node_modules is missing.")
        subprocess.check_call(["npm", "install"], cwd=ROOT)


def main() -> int:
    try:
        ensure_runtime_ready()
        api = DesktopApi()
        window = webview.create_window(
            f"{APP_NAME} {get_app_version()}",
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

        LOGGER.info("desktop shell starting version=%s", get_app_version())
        webview.start(_mark_runtime, debug=False)
        return 0
    except Exception:
        LOGGER.error("desktop shell crashed\n%s", traceback.format_exc())
        raise


if __name__ == "__main__":
    raise SystemExit(main())
