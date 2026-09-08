#!/usr/bin/env bash
# Build the unified android/ APK and publish it to backend/public/downloads/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT/android"
VARIANT="${1:-debug}"
OUT_DIR="$ROOT/backend/public/downloads"
OUT_APK="$OUT_DIR/eisy-myanmar.apk"

if [[ ! -d "$ANDROID_DIR" ]]; then
  echo "Missing android/ project at $ANDROID_DIR" >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]]; then
  if [[ -d "$HOME/Android/Sdk" ]]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  fi
fi

if [[ ! -f "$ANDROID_DIR/local.properties" ]]; then
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$ANDROID_DIR/local.properties"
    echo "[android] wrote local.properties sdk.dir=$ANDROID_HOME"
  else
    echo "Set ANDROID_HOME or create android/local.properties (see local.properties.example)" >&2
    exit 1
  fi
fi

cd "$ANDROID_DIR"
chmod +x ./gradlew

case "$VARIANT" in
  debug)
    TASK="assembleDebug"
    BUILT="app/build/outputs/apk/debug/app-debug.apk"
    ;;
  release)
    TASK="assembleRelease"
    BUILT="app/build/outputs/apk/release/app-release.apk"
    ;;
  *)
    echo "Usage: $0 [debug|release]" >&2
    exit 1
    ;;
esac

echo "[android] ./gradlew $TASK"
./gradlew --no-daemon "$TASK"

mkdir -p "$OUT_DIR"
cp -f "$ANDROID_DIR/$BUILT" "$OUT_APK"
echo "[android] published $OUT_APK ($(du -h "$OUT_APK" | cut -f1))"
file "$OUT_APK"
