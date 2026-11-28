#!/usr/bin/env bash
# Builds and tests the iOS app. Needs macOS with Xcode 16 or later.
#
#   tool/ci.sh core     # the BluelyticsCore package's tests (also runs on Linux, see README)
#   tool/ci.sh test     # the app's tests on an iPhone simulator; screenshots in build/screenshots/
#   tool/ci.sh build    # a device build without signing, as a compile check
#   tool/ci.sh all      # the three, in that order
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=Bluelytics.xcodeproj
SCHEME=Bluelytics
DERIVED=build/DerivedData
SHOTS=${SNAPSHOT_DIR:-$PWD/build/screenshots}

# The newest iPhone simulator installed, by its identifier.
simulator() {
  xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
best = None
for runtime, items in devices.items():
    if "iOS" not in runtime:
        continue
    version = tuple(int(p) for p in runtime.rsplit("iOS-", 1)[-1].split("-") if p.isdigit())
    for d in items:
        if d.get("isAvailable") and d["name"].startswith("iPhone"):
            if best is None or version > best[0]:
                best = (version, d["udid"], d["name"])
if best is None:
    sys.exit("no iPhone simulator is installed")
print(best[1])
'
}

core() {
  (cd BluelyticsCore && swift test)
}

test_app() {
  local id
  id=$(simulator)
  mkdir -p "$SHOTS"
  # Variables prefixed TEST_RUNNER_ reach the test process without the prefix.
  TEST_RUNNER_SNAPSHOT_DIR="$SHOTS" xcodebuild test \
    -project "$PROJECT" -scheme "$SCHEME" \
    -destination "id=$id" \
    -derivedDataPath "$DERIVED" \
    CODE_SIGNING_ALLOWED=NO
  echo "screenshots: $SHOTS"
}

build_device() {
  xcodebuild build \
    -project "$PROJECT" -scheme "$SCHEME" \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$DERIVED" \
    CODE_SIGNING_ALLOWED=NO
}

case "${1:-all}" in
  core) core ;;
  test) test_app ;;
  build) build_device ;;
  all) core; test_app; build_device ;;
  *) echo "usage: $0 [core|test|build|all]" >&2; exit 2 ;;
esac
