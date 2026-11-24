#!/bin/bash
# Run from the extracted project on a Mac with Xcode and Node installed.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test Tests/*.test.cjs
swift test
xcodebuild -project Homestead.xcodeproj -scheme Homestead -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
