from __future__ import annotations

import os
from pathlib import Path

from .direct_tool_backend import DirectToolBackend
from .interfaces import BanxuebangUiBackend, UnsupportedCapabilityError


def create_backend(
    *,
    backend_name: str | None = None,
    repo_root: Path | None = None,
    node_command: str | None = None,
) -> BanxuebangUiBackend:
    selected = (backend_name or os.environ.get("BXB_UI_BACKEND") or "direct-tool").strip().lower()

    if selected in {"direct-tool", "direct", "cli"}:
        return DirectToolBackend(
            repo_root=repo_root,
            node_command=node_command or os.environ.get("BXB_UI_NODE") or "node",
        )

    raise UnsupportedCapabilityError(
        f"Unsupported UI backend: {selected}. "
        "Currently supported: direct-tool. Future backends can plug in here."
    )
