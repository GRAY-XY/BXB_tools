from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path


SETTINGS_FILENAME = ".bxb_ui_settings.json"


@dataclass
class UiSettings:
    max_tool_rounds: int = 6
    max_memory_turns: int = 6
    theme_mode: str = "light"


def settings_path() -> Path:
    return Path.home() / SETTINGS_FILENAME


def load_ui_settings() -> UiSettings:
    path = settings_path()
    if not path.exists():
        return UiSettings()

    payload = json.loads(path.read_text(encoding="utf-8"))
    max_tool_rounds = int(payload.get("max_tool_rounds", 6))
    max_memory_turns = int(payload.get("max_memory_turns", 6))
    theme_mode = _normalize_theme_mode(str(payload.get("theme_mode", "light")))
    return UiSettings(
        max_tool_rounds=_clamp_setting_value(max_tool_rounds),
        max_memory_turns=_clamp_setting_value(max_memory_turns),
        theme_mode=theme_mode,
    )


def save_ui_settings(settings: UiSettings) -> Path:
    path = settings_path()
    payload = {
        "max_tool_rounds": _clamp_setting_value(int(settings.max_tool_rounds)),
        "max_memory_turns": _clamp_setting_value(int(settings.max_memory_turns)),
        "theme_mode": _normalize_theme_mode(settings.theme_mode),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def settings_as_dict(settings: UiSettings) -> dict[str, int | str]:
    payload = asdict(settings)
    payload["max_tool_rounds"] = _clamp_setting_value(int(payload.get("max_tool_rounds", 6)))
    payload["max_memory_turns"] = _clamp_setting_value(int(payload.get("max_memory_turns", 6)))
    payload["theme_mode"] = _normalize_theme_mode(str(payload.get("theme_mode", "light")))
    return payload


def _clamp_setting_value(value: int) -> int:
    return max(1, min(20, int(value)))


def _normalize_theme_mode(value: str) -> str:
    mode = (value or "light").strip().lower()
    return "dark" if mode == "dark" else "light"
