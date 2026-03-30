#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUN="/Users/mflower/.bun/bin/bun"
APP_NAME="Tempest"
KEYCHAIN_PROFILE="Tempest"
DEVELOPER_ID="Developer ID Application: Matthew Flower (24P9P34MKT)"

cd "$PROJECT_DIR"

# --- Install deps ---
echo "==> Installing dependencies..."
$BUN install

# --- Build ---
echo "==> Building ${APP_NAME} release..."
export ELECTROBUN_DEVELOPER_ID="$DEVELOPER_ID"
$BUN run build:release

# --- Find the .app ---
APP_PATH=$(find build -maxdepth 2 -name "*.app" -type d | head -1)
if [[ -z "$APP_PATH" ]]; then
  echo "ERROR: No .app bundle found in build/"
  exit 1
fi
echo "==> Built: $APP_PATH"

# --- Notarize ---
echo "==> Creating zip for notarization..."
ZIP_PATH="${APP_PATH}.zip"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

echo "==> Submitting to Apple for notarization (this may take a few minutes)..."
xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$KEYCHAIN_PROFILE" --wait

echo "==> Stapling notarization ticket..."
xcrun stapler staple "$APP_PATH"

# --- Create distributable zip ---
DIST_ZIP="${PROJECT_DIR}/${APP_NAME}.zip"
rm -f "$DIST_ZIP"
ditto -c -k --keepParent "$APP_PATH" "$DIST_ZIP"
rm -f "$ZIP_PATH"

echo ""
echo "==> Done! Distributable archive: ${DIST_ZIP}"
echo "    Send this zip to another Mac and it should open without Gatekeeper warnings."
