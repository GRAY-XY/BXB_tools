from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen


CONFIG_FILENAME = ".bxb_model_config.json"


@dataclass
class ModelConfig:
    api_key: str = ""
    base_url: str = ""
    model_name: str = ""
    context_length: int = 0


def config_path() -> Path:
    return Path.home() / CONFIG_FILENAME


def load_model_config() -> ModelConfig:
    path = config_path()
    if not path.exists():
        return ModelConfig()

    payload = json.loads(path.read_text(encoding="utf-8"))
    return ModelConfig(
        api_key=str(payload.get("api_key", "")),
        base_url=str(payload.get("base_url", "")),
        model_name=str(payload.get("model_name", "")),
        context_length=_safe_int(payload.get("context_length")),
    )


def save_model_config(config: ModelConfig) -> Path:
    path = config_path()
    path.write_text(json.dumps(asdict(config), ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def clear_model_config() -> Path:
    path = config_path()
    if path.exists():
        path.unlink()
    return path


def masked_key(api_key: str) -> str:
    value = (api_key or "").strip()
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * (len(value) - 8)}{value[-4:]}"


def derive_models_url(base_url: str) -> str:
    normalized = _normalize_base_url(base_url)
    if normalized.endswith("/models"):
        return normalized
    if normalized.endswith("/chat/completions"):
        return normalized[: -len("/chat/completions")] + "/models"
    if normalized.endswith("/responses"):
        return normalized[: -len("/responses")] + "/models"

    parsed = urlparse(normalized)
    path = parsed.path.rstrip("/")
    if not path:
        path = "/v1/models"
    elif path.endswith("/v1"):
        path = f"{path}/models"
    else:
        path = f"{path}/models"
    return urlunparse(parsed._replace(path=path))


def derive_chat_completions_url(base_url: str) -> str:
    normalized = _normalize_base_url(base_url)
    if normalized.endswith("/chat/completions"):
        return normalized
    if normalized.endswith("/models"):
        return normalized[: -len("/models")] + "/chat/completions"
    if normalized.endswith("/responses"):
        return normalized[: -len("/responses")] + "/chat/completions"

    parsed = urlparse(normalized)
    path = parsed.path.rstrip("/")
    if not path:
        path = "/v1/chat/completions"
    elif path.endswith("/v1"):
        path = f"{path}/chat/completions"
    else:
        path = f"{path}/chat/completions"
    return urlunparse(parsed._replace(path=path))


def test_model_connection(config: ModelConfig, *, timeout_sec: int = 15) -> dict[str, Any]:
    api_key = (config.api_key or "").strip()
    base_url = (config.base_url or "").strip()
    model_name = (config.model_name or "").strip()

    if not api_key:
        raise ValueError("API Key 不能为空。")
    if not base_url:
        raise ValueError("调用链接不能为空。")
    if not model_name:
        raise ValueError("模型名称不能为空。")

    models_url = derive_models_url(base_url)
    request = Request(
        models_url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "BXB-Homework-UI/1.0",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=timeout_sec) as response:
            status_code = getattr(response, "status", response.getcode())
            raw = response.read().decode("utf-8", errors="replace")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace") if getattr(error, "fp", None) else ""
        raise RuntimeError(f"模型服务返回 HTTP {error.code}。\n{detail[:800]}") from error
    except URLError as error:
        raise RuntimeError(f"无法连接模型服务：{error.reason}") from error

    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError as error:
        raise RuntimeError(f"模型服务返回了非 JSON 响应，无法校验：{error}") from error

    data = payload.get("data")
    models = data if isinstance(data, list) else []
    model_ids = [str(item.get("id", "")) for item in models if isinstance(item, dict)]
    model_available = model_name in model_ids
    selected_model = next((item for item in models if isinstance(item, dict) and str(item.get("id", "")) == model_name), None)
    context_length = extract_context_length(selected_model or {"id": model_name})

    return {
        "ok": model_available,
        "status_code": status_code,
        "models_url": models_url,
        "model_name": model_name,
        "context_length": context_length,
        "model_available": model_available,
        "models_count": len(model_ids),
        "sample_models": model_ids[:20],
        "message": (
            f"连接成功，已找到模型 {model_name}。"
            if model_available
            else f"连接成功，但模型列表里没有找到 {model_name}。"
        ),
    }


def _normalize_base_url(base_url: str) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("调用链接必须是完整的 http(s):// URL。")
    return normalized


def extract_context_length(model_payload: dict[str, Any]) -> int:
    for key in (
        "context_length",
        "max_context_length",
        "max_context_tokens",
        "max_input_tokens",
        "input_token_limit",
        "max_tokens",
    ):
        value = _safe_int(model_payload.get(key))
        if value > 0:
            return value

    nested = model_payload.get("limits")
    if isinstance(nested, dict):
        value = extract_context_length(nested)
        if value > 0:
            return value

    return known_context_length(str(model_payload.get("id", "")))


def known_context_length(model_name: str) -> int:
    normalized = model_name.lower()
    known = {
        "gpt-4o-mini": 128000,
        "gpt-4o": 128000,
        "gpt-4.1": 1047576,
        "gpt-4.1-mini": 1047576,
        "gpt-4.1-nano": 1047576,
        "gpt-5": 400000,
        "gpt-5-mini": 400000,
        "gpt-5-nano": 400000,
        "qwen3.5-plus": 1000000,
        "qwen-3.5-plus": 1000000,
        "qwen3.5plus": 1000000,
        "qwen-3.5plus": 1000000,
        "3.5plus": 1000000,
    }
    for key, value in known.items():
        if key in normalized:
            return value
    return 0


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0
