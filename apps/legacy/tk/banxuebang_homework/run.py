from __future__ import annotations

import argparse
from pathlib import Path

from .backend_factory import create_backend
from .tk_app import main


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch the Banxuebang homework UI shell.")
    parser.add_argument("--backend", default="direct-tool")
    parser.add_argument("--repo-root", default=None)
    parser.add_argument("--node", default=None)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    repo_root = Path(args.repo_root).resolve() if args.repo_root else None
    backend = create_backend(
        backend_name=args.backend,
        repo_root=repo_root,
        node_command=args.node,
    )
    main(backend=backend)
