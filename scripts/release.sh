#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if present (for local release builds)
[[ -f "$PROJECT_DIR/.env" ]] && set -a && source "$PROJECT_DIR/.env" && set +a

BUN="${BUN:-$(command -v bun)}"
APP_NAME="Tempest"
KEYCHAIN_PROFILE="${KEYCHAIN_PROFILE:-Tempest}"
DEVELOPER_ID="${ELECTROBUN_DEVELOPER_ID:?Set ELECTROBUN_DEVELOPER_ID env var (e.g. 'Developer ID Application: Name (TEAMID)')}"

cd "$PROJECT_DIR"

# --- Install deps ---
echo "==> Installing dependencies..."
$BUN install

# --- Build ---
echo "==> Building ${APP_NAME} release..."
export ELECTROBUN_DEVELOPER_ID="$DEVELOPER_ID"
$BUN run build:release

# --- Find the .app and DMG ---
APP_PATH=$(find build -maxdepth 2 -name "*.app" -type d | head -1)
DMG_PATH=$(find artifacts -name "*.dmg" | head -1)
if [[ -z "$APP_PATH" ]]; then
  echo "ERROR: No .app bundle found in build/"
  exit 1
fi
if [[ -z "$DMG_PATH" ]]; then
  echo "ERROR: No .dmg found in artifacts/"
  exit 1
fi
echo "==> Built: $APP_PATH"
echo "==> DMG:   $DMG_PATH"

# --- Notarize app ---
echo "==> Creating zip for notarization..."
ZIP_PATH="${APP_PATH}.zip"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

echo "==> Submitting app to Apple for notarization (this may take a few minutes)..."
xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$KEYCHAIN_PROFILE" --wait

echo "==> Stapling notarization ticket to app..."
xcrun stapler staple "$APP_PATH"
rm -f "$ZIP_PATH"

# --- Notarize DMG ---
echo "==> Submitting DMG to Apple for notarization..."
xcrun notarytool submit "$DMG_PATH" --keychain-profile "$KEYCHAIN_PROFILE" --wait

echo "==> Stapling notarization ticket to DMG..."
xcrun stapler staple "$DMG_PATH"

# --- Copy artifacts to project root ---
DIST_DMG="${PROJECT_DIR}/${APP_NAME}.dmg"
DIST_ZIP="${PROJECT_DIR}/${APP_NAME}.zip"
rm -f "$DIST_DMG" "$DIST_ZIP"
cp "$DMG_PATH" "$DIST_DMG"
ditto -c -k --keepParent "$APP_PATH" "$DIST_ZIP"

echo ""
echo "==> Done!"
echo "    DMG: ${DIST_DMG}"
echo "    ZIP: ${DIST_ZIP}"
echo "    Send either to another Mac — they should open without Gatekeeper warnings."
