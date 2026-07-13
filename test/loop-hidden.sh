#!/bin/bash
# Background Safari, then run advance-inplace.js N times (simulating N
# consecutive `ended` advances the extension would do while hidden).
# Prints each result. Reactivates Safari at the end.
set -uo pipefail
cd "$(dirname "$0")/.."
N="${1:-5}"
EXPR="$(cat test/advance-inplace.js)"

echo "== backgrounding Safari (activating Finder) =="
osascript -e 'tell application "Finder" to activate' >/dev/null 2>&1
osascript -e 'delay 1' >/dev/null

for i in $(seq 1 "$N"); do
  KICK="(function(){ window.__ytsasR='PENDING'; Promise.resolve((function(){return ($EXPR);})()).then(v=>window.__ytsasR=JSON.stringify(v)).catch(e=>window.__ytsasR=JSON.stringify({__error:String(e)})); return 'k'; })();"
  JS="$KICK" osascript -e 'set c to system attribute "JS"' -e 'tell application "Safari" to do JavaScript c in current tab of window 1' >/dev/null 2>&1
  # poll for result
  R=""
  for j in $(seq 1 20); do
    R="$(JS="window.__ytsasR" osascript -e 'set c to system attribute "JS"' -e 'tell application "Safari" to return (do JavaScript c in current tab of window 1)' 2>/dev/null)"
    [ "$R" != "PENDING" ] && [ -n "$R" ] && break
    osascript -e 'delay 0.4' >/dev/null
  done
  echo "advance #$i: $R"
  osascript -e 'delay 1.5' >/dev/null
done

echo "== reactivating Safari =="
osascript -e 'tell application "Safari" to activate' >/dev/null 2>&1
