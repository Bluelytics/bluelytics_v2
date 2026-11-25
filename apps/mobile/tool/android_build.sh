#!/usr/bin/env bash
# Builds the Android release bundle and APK in a container that has the Android SDK and a JDK
# Gradle accepts, for machines without them.
#
#   tool/android_build.sh        # → build/android/app-release.aab, app-release.apk
#
# Signing follows android/key.properties (see README.md): the keystore it names is mounted read-only.
# Without that file the build is signed with the debug key. The project is mounted read-only and
# copied inside the container, so nothing owned by root lands in it.
set -euo pipefail

IMAGE=${FLUTTER_IMAGE:-ghcr.io/cirruslabs/flutter:3.38.2}
APP=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT=$APP/build/android
mkdir -p "$OUT"

mounts=(-v "$APP":/src:ro -v "$OUT":/out -v bluelytics-gradle:/root/.gradle -v bluelytics-pub:/root/.pub-cache)
signing=debug
if [[ -f $APP/android/key.properties ]]; then
  keystore=$(sed -n 's/^storeFile=//p' "$APP/android/key.properties" | tr -d '\r')
  [[ $keystore = /* ]] || keystore=$APP/android/$keystore
  [[ -f $keystore ]] || { echo "android/key.properties names a keystore that does not exist: $keystore" >&2; exit 1; }
  mounts+=(-v "$keystore":/keys/upload.jks:ro)
  signing=upload
fi

docker run --rm "${mounts[@]}" -e SIGNING=$signing -e OWNER="$(id -u):$(id -g)" "$IMAGE" bash -euo pipefail -c '
  mkdir /work
  tar -C /src --exclude=./build --exclude=./.dart_tool --exclude=./android/.gradle --exclude=./android/local.properties --exclude=./linux/flutter/ephemeral -cf - . | tar -xf - -C /work
  cd /work
  if [[ $SIGNING = upload ]]; then
    sed -i "s|^storeFile=.*|storeFile=/keys/upload.jks|" android/key.properties
  fi
  flutter pub get
  flutter build appbundle --release
  flutter build apk --release
  cp build/app/outputs/bundle/release/app-release.aab build/app/outputs/flutter-apk/app-release.apk /out/
  echo
  echo "Signed with:"
  keytool -printcert -jarfile /out/app-release.aab | grep -m1 -E "Owner|Not a signed"
  chown "$OWNER" /out/app-release.aab /out/app-release.apk
'
echo "Wrote $OUT/app-release.aab and $OUT/app-release.apk (signing: $signing key)"
