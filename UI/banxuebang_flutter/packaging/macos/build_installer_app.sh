#!/bin/bash
# 构建 BXB Student 一键安装器 .app
# 用法: build_installer_app.sh <version> <dmg_download_url> <output_dir>
set -euo pipefail

VERSION="${1:?version required}"
DMG_URL="${2:?dmg url required}"
OUTPUT_DIR="${3:?output dir required}"

APP_NAME="安装 BXB Student"
BUNDLE_ID="com.grayxy.bxbstudent.installer"
INSTALLER_APP="$OUTPUT_DIR/${APP_NAME}.app"

mkdir -p "$OUTPUT_DIR"
rm -rf "$INSTALLER_APP"

# --- 构建 .app bundle 目录结构 ---
mkdir -p "$INSTALLER_APP/Contents/MacOS"
mkdir -p "$INSTALLER_APP/Contents/Resources"

# --- Info.plist ---
cat > "$INSTALLER_APP/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleExecutable</key>
  <string>installer</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleSignature</key>
  <string>????</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSUIElement</key>
  <false/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppleEventsUsageDescription</key>
  <string>安装器需要运行脚本来完成安装。</string>
</dict>
</plist>
PLIST

# --- 主可执行脚本 ---
# 这个脚本运行在用户 macOS 上，使用 osascript 提供 GUI 对话框
cat > "$INSTALLER_APP/Contents/MacOS/installer" << SCRIPT
#!/bin/bash
set -euo pipefail

DMG_URL="${DMG_URL}"
APP_NAME="BXB Student"
APP_DEST="/Applications/\${APP_NAME}.app"
TMP_DIR="\$(mktemp -d)"
DMG_PATH="\$TMP_DIR/bxb_student.dmg"
MOUNT_POINT="\$TMP_DIR/dmg_mount"

cleanup() {
  hdiutil detach "\$MOUNT_POINT" -quiet 2>/dev/null || true
  rm -rf "\$TMP_DIR"
}
trap cleanup EXIT

# 欢迎对话框
osascript << 'EOF'
display dialog "欢迎安装 BXB Student！

点击「安装」将自动下载并安装应用到「应用程序」文件夹。

安装完成后可删除本安装器。" ¬
  buttons {"取消", "安装"} ¬
  default button "安装" ¬
  with title "BXB Student 安装器" ¬
  with icon note
if button returned of result is "取消" then
  error number -128
end if
EOF

# 下载中提示（非阻塞背景进程方式，osascript 无法真正做进度条，用简单提示代替）
osascript << 'EOF' &
display dialog "正在下载 BXB Student，请稍候…

下载完成后会自动继续安装。" ¬
  buttons {} ¬
  with title "BXB Student 安装器" ¬
  giving up after 300
EOF
DIALOG_PID=\$!

# 下载 DMG
curl -L --progress-bar -o "\$DMG_PATH" "\$DMG_URL"

# 关闭下载提示
kill \$DIALOG_PID 2>/dev/null || true
osascript -e 'tell application "System Events" to keystroke return' 2>/dev/null || true

# 挂载 DMG
mkdir -p "\$MOUNT_POINT"
hdiutil attach "\$DMG_PATH" -mountpoint "\$MOUNT_POINT" -nobrowse -quiet

# 找到 .app
FOUND_APP="\$(find "\$MOUNT_POINT" -maxdepth 2 -name "\${APP_NAME}.app" | head -n1)"
if [ -z "\$FOUND_APP" ]; then
  osascript -e 'display alert "安装失败" message "未在 DMG 中找到应用，请联系开发者。" as critical'
  exit 1
fi

# 如果已安装，先删除旧版本
if [ -d "\$APP_DEST" ]; then
  rm -rf "\$APP_DEST"
fi

# 复制到 /Applications
cp -R "\$FOUND_APP" "\$APP_DEST"

# 移除隔离属性（这就是 Gatekeeper 绕过的关键）
/usr/bin/xattr -dr com.apple.quarantine "\$APP_DEST" 2>/dev/null || true

# 完成
osascript << 'EOF'
display dialog "BXB Student 安装完成！

已安装到「应用程序」文件夹，现在可以直接打开使用。" ¬
  buttons {"好的，打开应用"} ¬
  default button "好的，打开应用" ¬
  with title "安装完成" ¬
  with icon note
EOF

open "\$APP_DEST"
SCRIPT

chmod +x "$INSTALLER_APP/Contents/MacOS/installer"

# --- 用 codesign 自签名（ad-hoc，让 macOS 不报"已损坏"）---
codesign --force --deep --sign - "$INSTALLER_APP" 2>/dev/null || true

echo "[installer] Built: $INSTALLER_APP"
