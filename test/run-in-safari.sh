#!/bin/bash
# Run a JS file in Safari's current tab and print the (string) result.
# Requires: Safari → Settings → Developer → "Allow JavaScript from Apple Events".
# Usage: ./run-in-safari.sh path/to/script.js
set -euo pipefail
JS_FILE="${1:?usage: run-in-safari.sh <script.js>}"
JS_CONTENT="$(cat "$JS_FILE")"
# Pass the JS via an env var to avoid AppleScript string-escaping hell.
JS="$JS_CONTENT" osascript <<'APPLESCRIPT'
set jsCode to (system attribute "JS")
tell application "Safari"
    set theResult to do JavaScript jsCode in current tab of window 1
    return theResult
end tell
APPLESCRIPT
