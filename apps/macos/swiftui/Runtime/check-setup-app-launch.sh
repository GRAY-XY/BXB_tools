#!/bin/bash
set -euo pipefail
app="${1:?Pass the packaged app path}"
validation_root="$(mktemp -d /tmp/bxb-setup-app-launch.XXXXXX)"
executable="$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$app/Contents/Info.plist")"
app_pid=""
cleanup() {
  if test -n "$app_pid"; then kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true; fi
  rm -rf "$validation_root"
}
trap cleanup EXIT
BXB_TEST_APPDATA="$validation_root/data" \
BXB_TEST_KEYCHAIN_SERVICE="com.grayxy.bxbhomework.setup-launch.$RANDOM" \
BXB_TEST_DEFAULTS_SUITE="com.grayxy.bxbhomework.setup-launch.$RANDOM" \
  "$app/Contents/MacOS/$executable" > "$validation_root/app.log" 2>&1 &
app_pid=$!
for attempt in {1..40}; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$validation_root/app.log"
    echo 'setup-app-launch=failed: app exited during first-run presentation' >&2
    exit 1
  fi
  sleep 0.25
done
app_log="$(cat "$validation_root/app.log")"
if [[ "$app_log" == *"Fatal error"* || "$app_log" == *"No Observable object"* ]]; then
  cat "$validation_root/app.log"
  exit 1
fi
printf 'setup-app-launch=ok: packaged app survived first-run presentation\n'
