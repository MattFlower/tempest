#!/bin/bash
# Capture a screenshot of just the Tempest window
# Usage: ./scripts/screenshot.sh [output-path]

OUTPUT="${1:-/tmp/tempest-screenshot.png}"

# Get window bounds via AppleScript
BOUNDS=$(osascript -e '
tell application "System Events"
  tell process "bun"
    set frontmost to true
    set theWindow to first window
    set {x, y} to position of theWindow
    set {w, h} to size of theWindow
    return "" & x & "," & y & "," & w & "," & h
  end tell
end tell
' 2>/dev/null)

if [ -z "$BOUNDS" ]; then
  echo "Error: Could not find Tempest window (bun process)"
  exit 1
fi

sleep 0.3
screencapture -x -R "$BOUNDS" "$OUTPUT"
echo "Screenshot saved to $OUTPUT"
