#!/usr/bin/env python3
"""Create a portable skill archive from an explicit source-only allowlist."""

import hashlib
import json
from pathlib import Path
import subprocess
import zipfile


def main():
    repo = Path(__file__).resolve().parents[2]
    skill = repo / "skills" / "banxuebang"
    subprocess.run(["node", str(repo / "release/scripts/sync-agent-skill.mjs"), "--check"], check=True)
    version = json.loads((skill / "package.json").read_text(encoding="utf-8"))["version"]
    files = [skill / name for name in ("SKILL.md", "LICENSE", ".nvmrc", "package.json", "package-lock.json", "runtime-manifest.json")]
    for directory, pattern in (("agents", "*.yaml"), ("scripts", "*.mjs"), ("runtime", "*.js"),
                               ("references", "*.md"), ("references", "*.json")):
        files.extend(sorted((skill / directory).glob(pattern)))
    if len(files) != len(set(files)):
        raise ValueError("Duplicate source files in archive allowlist")
    output = repo / "release/artifacts/agent-skills"
    output.mkdir(parents=True, exist_ok=True)
    archive_path = output / f"banxuebang-{version}.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(files):
            if file.is_symlink() or not file.is_file() or not file.resolve().is_relative_to(skill.resolve()):
                raise ValueError(f"Invalid package source: {file}")
            entry = zipfile.ZipInfo("banxuebang/" + file.relative_to(skill).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (0o100755 if file.suffix == ".mjs" else 0o100644) << 16
            archive.writestr(entry, file.read_bytes(), compresslevel=9)
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    archive_path.with_suffix(".zip.sha256").write_text(f"{digest}  {archive_path.name}\n", encoding="ascii")
    print(f"Skill archive: {archive_path}")
    print(f"Source files: {len(files)}; size: {archive_path.stat().st_size} bytes")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    main()
