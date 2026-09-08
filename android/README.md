# Eisy Myanmar — Android shell

Native Android WebView app that loads the Eisy Myanmar web product (default: `https://eisymyanmar.com`).

## Features

- Package id: `com.eisymyanmar.app`
- Branded launcher icons (mipmap + adaptive) from `backend/public/brand/logo-icon.png`
- **No action / title bar** — dark Material3 `NoActionBar` theme; web UI owns chrome
- Edge-to-edge status bar with dark slate background
- Debug + release builds (release uses the debug keystore by default for easy sideload)

## Prerequisites

- JDK 17+ (`JAVA_HOME`)
- Android SDK 35 + Build-Tools 35 (`ANDROID_HOME` / `sdk.dir` in `local.properties`)

```bash
cp android/local.properties.example android/local.properties
# edit sdk.dir=...
```

## Build the APK

From the repo root:

```bash
npm run android:apk
# or
./scripts/build-android-apk.sh
```

Outputs:

- `android/app/build/outputs/apk/debug/app-debug.apk`
- Copied to `backend/public/downloads/eisy-myanmar.apk` (landing-page download)

Release variant:

```bash
./scripts/build-android-apk.sh release
```

## Override the start URL

In `android/local.properties`:

```
eisy.web.url=https://staging.example.com
```
