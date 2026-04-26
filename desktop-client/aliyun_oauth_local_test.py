"""
Local Alibaba Cloud OAuth test for Native apps.

What this script tests:
1. Open the official Alibaba Cloud OAuth login page in a browser.
2. Receive the authorization code on a localhost callback.
3. Exchange the code for access_token / refresh_token / id_token.
4. Decode the id_token payload locally for quick inspection.

What this script does NOT prove yet:
- Whether Bailian model inference can be called directly with this user token.
- Whether user-side billing works for Bailian without your own backend.

Official references:
- Native app OAuth: https://help.aliyun.com/zh/ram/access-alibaba-cloud-apis-from-a-native-application
- OAuth overview: https://help.aliyun.com/zh/ram/overview-of-oauth-applications
- OIDC user info: https://help.aliyun.com/zh/ram/obtain-user-information-through-oidc
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import secrets
import socket
import threading
import time
import urllib.parse
import webbrowser
from dataclasses import dataclass

import requests


AUTHORIZATION_ENDPOINT = "https://signin.aliyun.com/oauth2/v1/auth"
TOKEN_ENDPOINT = "https://oauth.aliyun.com/v1/token"
DEFAULT_SCOPES = "openid aliuid profile"


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def generate_pkce_pair() -> tuple[str, str]:
    verifier = _base64url(secrets.token_bytes(48))
    challenge = _base64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def decode_jwt_payload(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return {}
        payload = parts[1]
        padding = "=" * (-len(payload) % 4)
        raw = base64.urlsafe_b64decode(payload + padding)
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@dataclass
class CallbackResult:
    code: str | None = None
    state: str | None = None
    error: str | None = None


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    result: CallbackResult
    done_event: threading.Event

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        self.result.code = (query.get("code") or [None])[0]
        self.result.state = (query.get("state") or [None])[0]
        self.result.error = (query.get("error") or [None])[0]

        body = (
            "<html><body style='font-family:Segoe UI,Arial;padding:32px;'>"
            "<h2>Alibaba OAuth callback received.</h2>"
            "<p>You can return to the terminal now.</p>"
            "</body></html>"
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.done_event.set()

    def log_message(self, fmt: str, *args) -> None:
        return


def build_authorize_url(client_id: str, redirect_uri: str, state: str, code_challenge: str, scopes: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scopes,
        "state": state,
        "code_challenge_method": "S256",
        "code_challenge": code_challenge,
        "prompt": "admin_consent",
    }
    return f"{AUTHORIZATION_ENDPOINT}?{urllib.parse.urlencode(params)}"


def exchange_code(client_id: str, code: str, redirect_uri: str, code_verifier: str) -> dict:
    resp = requests.post(
        TOKEN_ENDPOINT,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "code": code,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def run_local_test(client_id: str, scopes: str, open_browser: bool = True, timeout_seconds: int = 180) -> dict:
    port = find_free_port()
    redirect_uri = f"http://127.0.0.1:{port}/callback"
    state = secrets.token_urlsafe(24)
    code_verifier, code_challenge = generate_pkce_pair()
    auth_url = build_authorize_url(client_id, redirect_uri, state, code_challenge, scopes)

    result = CallbackResult()
    done_event = threading.Event()

    class _Handler(CallbackHandler):
        pass

    _Handler.result = result
    _Handler.done_event = done_event
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        print(f"Redirect URI: {redirect_uri}")
        print(f"Scopes: {scopes}")
        print("\nOpen this URL in a browser and complete Alibaba Cloud login/consent:\n")
        print(auth_url)
        print()
        if open_browser:
            webbrowser.open(auth_url)

        if not done_event.wait(timeout_seconds):
            raise TimeoutError("Timed out waiting for the OAuth callback.")
        if result.error:
            raise RuntimeError(f"Alibaba OAuth returned error: {result.error}")
        if not result.code:
            raise RuntimeError("No authorization code received.")
        if result.state != state:
            raise RuntimeError("State mismatch. Aborting for safety.")

        token_data = exchange_code(client_id, result.code, redirect_uri, code_verifier)
        token_data["id_token_payload"] = decode_jwt_payload(token_data.get("id_token", ""))
        return token_data
    finally:
        try:
            server.shutdown()
        except Exception:
            pass
        server.server_close()
        time.sleep(0.1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Alibaba Cloud OAuth Native-app tester")
    parser.add_argument("--client-id", required=True, help="Alibaba Cloud OAuth application client_id")
    parser.add_argument("--scopes", default=DEFAULT_SCOPES, help="OAuth scopes, default: openid aliuid profile")
    parser.add_argument("--no-browser", action="store_true", help="Do not auto-open the browser")
    parser.add_argument("--timeout", type=int, default=180, help="Callback timeout in seconds")
    args = parser.parse_args()

    token_data = run_local_test(
        client_id=args.client_id,
        scopes=args.scopes,
        open_browser=not args.no_browser,
        timeout_seconds=args.timeout,
    )

    print("OAuth exchange succeeded.\n")
    safe_output = {
        "token_type": token_data.get("token_type"),
        "expires_in": token_data.get("expires_in"),
        "has_access_token": bool(token_data.get("access_token")),
        "has_refresh_token": bool(token_data.get("refresh_token")),
        "id_token_payload": token_data.get("id_token_payload") or {},
    }
    print(json.dumps(safe_output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
