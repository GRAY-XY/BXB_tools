from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .backend_factory import create_backend
from .interfaces import UiBackendError


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test the UI backend without launching Tkinter.")
    parser.add_argument("--backend", default="direct-tool")
    parser.add_argument("--repo-root", default=None)
    parser.add_argument("--node", default=None)
    parser.add_argument(
        "--tool",
        choices=["session_status", "list_terms", "list_courses", "list_tasks"],
        default="session_status",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve() if args.repo_root else None
    backend = create_backend(
        backend_name=args.backend,
        repo_root=repo_root,
        node_command=args.node,
    )

    try:
        if args.tool == "session_status":
            payload = backend.session_status()
        elif args.tool == "list_terms":
            payload = backend.list_terms()
        elif args.tool == "list_courses":
            payload = backend.list_courses()
        else:
            payload = backend.list_tasks(page=1, size=5)
    except UiBackendError as error:
        print(str(error), file=sys.stderr)
        return 2

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
