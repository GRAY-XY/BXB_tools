#!/usr/bin/env python3
"""Sign every nested executable before its enclosing bundle (never --deep sign)."""
import argparse
import json
from pathlib import Path
import plistlib
import subprocess

MACH_O = {b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe",
          b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"}
BUNDLES = {".app", ".framework", ".xpc", ".appex"}


def signing_plan(app):
    bundles = [app, *(item for item in app.rglob("*") if not item.is_symlink() and item.is_dir() and item.suffix in BUNDLES)]
    main_executables = set()
    for bundle in bundles:
        for info in [bundle / "Contents/Info.plist", bundle / "Resources/Info.plist", bundle / "Versions/Current/Resources/Info.plist"]:
            if info.is_file():
                with info.open("rb") as stream:
                    name = plistlib.load(stream).get("CFBundleExecutable")
                if name:
                    main = bundle / name if bundle.suffix == ".framework" else bundle / "Contents/MacOS" / name
                    main_executables.add(main.resolve())
                break
    targets = []
    for item in app.rglob("*"):
        if item.is_symlink():
            continue
        if item.is_dir() and item.suffix in BUNDLES:
            targets.append(item)
        elif item.is_file() and item.resolve() not in main_executables:
            with item.open("rb") as stream:
                if stream.read(4) in MACH_O:
                    targets.append(item)
    # Depth-first ordering seals each container only after its children.
    targets.sort(key=lambda item: (-len(item.parts), str(item)))
    targets.append(app)
    return [{"path": str(item), "javascriptRuntime": (
        item == app / "Contents/Helpers/node"
        or (item != app and item.suffix == ".app")
        or ("Playwright" in item.parts and item.is_file() and item.suffix not in {".dylib", ".node"})
    )} for item in targets]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--identity")
    parser.add_argument("--entitlements", type=Path)
    parser.add_argument("--keychain", type=Path)
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    app = args.app.resolve()
    if not app.is_dir() or app.suffix != ".app":
        parser.error("--app must be an existing .app directory")
    plan = signing_plan(app)
    if args.plan:
        print(json.dumps(plan, indent=2))
        return
    if not args.identity or not args.identity.startswith("Developer ID Application:"):
        parser.error("--identity must name a Developer ID Application certificate")
    if not args.entitlements or not args.entitlements.is_file():
        parser.error("--entitlements must point to JavaScript runtime entitlements")
    for item in plan:
        command = ["codesign", "--force", "--sign", args.identity, "--timestamp", "--options", "runtime"]
        if args.keychain:
            command.extend(["--keychain", str(args.keychain)])
        if item["javascriptRuntime"]:
            command.extend(["--entitlements", str(args.entitlements)])
        subprocess.run(command + [item["path"]], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)], check=True)


if __name__ == "__main__":
    main()
