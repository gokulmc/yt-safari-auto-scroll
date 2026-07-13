#!/bin/bash
# Run an ASYNC JS snippet (an expression evaluating to a Promise) in Safari's
# current tab, wait for it, and print the resolved value as JSON.
# The snippet's Promise result is stashed on window.__ytsas, then polled.
# Requires: Safari → Settings → Developer → "Allow JavaScript from Apple Events".
# Usage: ./run-async-in-safari.sh path/to/promise-expr.js
set -euo pipefail
JS_FILE="${1:?usage: run-async-in-safari.sh <promise-expr.js>}"
EXPR="$(cat "$JS_FILE")"

# Kick off: evaluate the expression, store JSON result (or error) on window.
KICKOFF="(function(){ window.__ytsas='PENDING'; try { Promise.resolve((function(){ return ($EXPR); })()).then(function(v){ window.__ytsas = JSON.stringify(v); }).catch(function(e){ window.__ytsas = JSON.stringify({__error:String(e)}); }); } catch(e){ window.__ytsas = JSON.stringify({__syncError:String(e)}); } return 'kicked'; })();"

JS="$KICKOFF" osascript <<'APPLESCRIPT' >/dev/null
set jsCode to (system attribute "JS")
tell application "Safari" to do JavaScript jsCode in current tab of window 1
APPLESCRIPT

# Poll up to ~15s for the result.
for i in $(seq 1 30); do
  RESULT="$(JS="window.__ytsas" osascript <<'APPLESCRIPT'
set jsCode to (system attribute "JS")
tell application "Safari" to return (do JavaScript jsCode in current tab of window 1)
APPLESCRIPT
)"
  if [ "$RESULT" != "PENDING" ] && [ -n "$RESULT" ]; then
    echo "$RESULT"
    exit 0
  fi
  osascript -e 'delay 0.5' >/dev/null
done
echo '{"__error":"timed out waiting for result"}'
