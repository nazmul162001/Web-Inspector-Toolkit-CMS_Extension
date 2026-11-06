#!/bin/zsh
set -euo pipefail

# Build the macOS helper and register it as a Chrome native-messaging host.
# Run from anywhere; uses this script's folder as the source.

ROOT="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="nfcjfoinafgpkfpmgmephohebcbhimll"
HOST_NAME="com.webinspectortoolkit.screenshot"
SUPPORT="$HOME/Library/Application Support/WebInspectorToolkit"
APP="$SUPPORT/Web Inspector Screenshot.app"
BIN="$APP/Contents/MacOS/wit-screenshot-helper"

echo "Building Web Inspector Screenshot helper…"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"

ARCH="$(uname -m)"
if [ "$ARCH" = "x86_64" ]; then TARGET="x86_64-apple-macos14.0"; else TARGET="arm64-apple-macos14.0"; fi
xcrun swiftc -O -target "$TARGET" \
  -o "$BIN" \
  -framework AppKit -framework ScreenCaptureKit -framework CoreGraphics -framework UniformTypeIdentifiers \
  "$ROOT/Sources/NativeMessaging.swift" \
  "$ROOT/Sources/Capture.swift" \
  "$ROOT/Sources/Overlay.swift" \
  "$ROOT/Sources/main.swift"

chmod +x "$BIN"

HOST_JSON=$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "Full-display Select Area for Web Inspector Toolkit",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
)

register() {
  local dir="$1"
  mkdir -p "$dir"
  echo "$HOST_JSON" > "$dir/$HOST_NAME.json"
  echo "Registered native host in $dir"
}

register "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
if [ -d "$HOME/Library/Application Support/Google/Chrome Canary" ]; then
  register "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
fi
if [ -d "$HOME/Library/Application Support/Chromium" ]; then
  register "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
fi

echo
echo "Done. Next:"
echo "  1. Reload the unpacked extension in chrome://extensions"
echo "  2. Click Select Area once — macOS will ask for Screen Recording"
echo "  3. System Settings → Privacy & Security → Screen Recording"
echo "     Enable «Web Inspector Screenshot», then try Select Area again"
echo
echo "The helper lives at:"
echo "  $APP"
