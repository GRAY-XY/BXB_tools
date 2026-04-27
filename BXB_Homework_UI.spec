# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


repo_root = Path.cwd()
node_zip = repo_root / "build_assets" / "node-v22.15.0-win-x64.zip"
browser_zip = repo_root / "build_assets" / "ms-playwright-browsers.zip"

datas = [
    (str(repo_root / "src"), "payload/src"),
    (str(repo_root / "scripts"), "payload/scripts"),
    (str(repo_root / "node_modules"), "payload/node_modules"),
    (str(repo_root / "package.json"), "payload"),
    (str(repo_root / "package-lock.json"), "payload"),
    (str(repo_root / "README.md"), "payload"),
]

if node_zip.exists():
    datas.append((str(node_zip), "payload/runtime"))

if browser_zip.exists():
    datas.append((str(browser_zip), "payload/runtime"))

a = Analysis(
    ["UI/banxuebang_homework/standalone_launcher.py"],
    pathex=[str(repo_root)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "ttkbootstrap",
        "ttkbootstrap.style",
        "ttkbootstrap.widgets",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="BXB_Homework_UI",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
