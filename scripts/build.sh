#!/usr/bin/env bash
# build.sh — convenience wrapper around xcodebuild for the packaged
# Safari extension wrapper app.
#
# Requires xcode/ to exist (produced by the safari-web-extension-packager —
# see README.md) and the "YT Shorts Auto-Scroll" scheme to be SHARED
# (Xcode > Manage Schemes > Shared, committed under
# xcode/**/xcshareddata/xcschemes/). Schemes otherwise only live in
# gitignored xcuserdata/, generated on first Xcode open — so this script
# would fail with "scheme not found" on a fresh clone that never opened
# Xcode first.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d "xcode" ]; then
  echo "xcode/ not found — run the packager first (see README.md)."
  exit 1
fi

PROJECT="xcode/YT Shorts Auto-Scroll.xcodeproj"
SCHEME="YT Shorts Auto-Scroll"
DERIVED_DATA_PATH="build"

# CODE_SIGN_IDENTITY="-" is an ad-hoc signing fallback for a from-clone
# build with no team configured. For a persistent (non-Gatekeeper-blocked)
# install, open the project in Xcode first, select your own team under
# Signing & Capabilities, and build from there (or re-run this script —
# xcodebuild will pick up the project's configured team instead of the
# ad-hoc override once one is set).
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=YES \
  build

APP_PATH=$(find "$DERIVED_DATA_PATH/Build/Products/Release" -maxdepth 1 -name "*.app" | head -n 1)

if [ -z "$APP_PATH" ]; then
  echo "Build succeeded but no .app was found under $DERIVED_DATA_PATH/Build/Products/Release"
  exit 1
fi

echo "Built: $APP_PATH"
open "$APP_PATH"
