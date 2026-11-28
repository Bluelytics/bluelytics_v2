#!/usr/bin/env bash
# Builds the Android release bundle and APK in a container that has the Android SDK and a JDK Gradle
# accepts (tool/Dockerfile), for machines without them.
#
#   tool/build.sh              # → build/android/app-release.aab, app-release.apk
#   tool/build.sh test lint    # also runs the unit tests and Android lint first
#
# Signing follows key.properties next to settings.gradle.kts (see README.md): the keystore it names
# is mounted read-only. Without that file the build is signed with the debug key. The project is
# mounted read-only and copied inside the container, so nothing owned by root lands in it.
set -euo pipefail

APP=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
IMAGE=${ANDROID_IMAGE:-bluelytics-android-build}
OUT=$APP/build/android
mkdir -p "$OUT"

docker build -q -t "$IMAGE" "$APP/tool" > /dev/null

tasks=()
for step in "$@"; do
  case $step in
    test) tasks+=(:app:testDebugUnitTest) ;;
    lint) tasks+=(:app:lintRelease) ;;
    *) echo "unknown step: $step (test, lint)" >&2; exit 2 ;;
  esac
done
tasks+=(:app:bundleRelease :app:assembleRelease)

# Gradle's caches live in a named volume, shared with other projects' builds on this machine.
mounts=(-v "$APP":/src:ro -v "$OUT":/out -v bluelytics-gradle:/root/.gradle)
signing=debug
if [[ -f $APP/key.properties ]]; then
  keystore=$(sed -n 's/^storeFile=//p' "$APP/key.properties" | tr -d '\r')
  [[ $keystore = /* ]] || keystore=$APP/$keystore
  [[ -f $keystore ]] || { echo "key.properties names a keystore that does not exist: $keystore" >&2; exit 1; }
  mounts+=(-v "$keystore":/keys/upload.jks:ro)
  signing=upload
fi

docker run --rm "${mounts[@]}" --memory 7g -e SIGNING=$signing -e OWNER="$(id -u):$(id -g)" -e TASKS="${tasks[*]}" "$IMAGE" bash -euo pipefail -c '
  mkdir /work
  tar -C /src --exclude=./build --exclude=./app/build --exclude=./.gradle --exclude=./.kotlin --exclude=./local.properties -cf - . | tar -xf - -C /work
  cd /work
  if [[ $SIGNING = upload ]]; then
    sed -i "s|^storeFile=.*|storeFile=/keys/upload.jks|" key.properties
  fi
  ./gradlew --no-daemon --console=plain $TASKS
  cp app/build/outputs/bundle/release/app-release.aab app/build/outputs/apk/release/app-release.apk /out/
  if [[ -f app/build/reports/lint-results-release.html ]]; then
    cp app/build/reports/lint-results-release.html /out/
  fi
  echo
  echo "Signed with:"
  keytool -printcert -jarfile /out/app-release.aab | grep -m1 -E "Owner|Not a signed"
  chown "$OWNER" /out/*
'
echo "Wrote $OUT/app-release.aab and $OUT/app-release.apk (signing: $signing key)"
