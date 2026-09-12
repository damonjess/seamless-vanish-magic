# Building the Android APK

This project is a Lovable/TanStack Start web app wrapped with Capacitor for Android.

## Prerequisites

1. **Node.js 22+** (required by Capacitor CLI)
2. **Android Studio** (Hedgehog 2023.1.1 or newer)
3. **Android SDK** (API 35, installed via Android Studio SDK Manager)

## Quick Start

### Option A: Build from the command line

```bash
# 1. Install dependencies
npm install

# 2. Set your Lovable API key
cp .env.example .env
# Edit .env and add your VITE_LOVABLE_API_KEY

# 3. Build web assets + sync to Android project + open in Android Studio
npm run android:open
```

### Option B: Build and install via Android Studio

```bash
# 1. Install dependencies
npm install

# 2. Set your Lovable API key
cp .env.example .env
# Edit .env and add your VITE_LOVABLE_API_KEY

# 3. Build web assets and sync to Android project
npm run android:sync

# 4. Open the android/ folder in Android Studio
#    File > Open > select the android/ directory

# 5. In Android Studio, press the green Run button (or Shift+F10)
#    to build and install on your connected phone
```

## Installing on your phone

1. Enable **Developer Options** on your Android phone:
   - Settings > About Phone > tap "Build Number" 7 times
2. Enable **USB Debugging**:
   - Settings > Developer Options > USB Debugging = ON
3. Connect your phone via USB
4. In Android Studio, select your device from the dropdown and press Run

### Alternative: Install the APK directly

After building, the APK is at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

You can transfer this file to your phone and install it (enable "Install from unknown sources" in settings).

## Available npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the Lovable dev server (SSR mode) |
| `npm run build:capacitor:web` | Build static SPA assets to `dist/` |
| `npm run android:sync` | Build web assets + sync to Android project |
| `npm run android:open` | Sync + open project in Android Studio |
| `npm run android:build` | Sync + build debug APK via Gradle |

## How it works

- `vite.capacitor.config.ts` — A separate Vite config that builds a client-only SPA (no SSR/nitro). This is different from the main `vite.config.ts` which uses TanStack Start for SSR.
- `capacitor.config.ts` — Tells Capacitor to use `dist/` as the web assets directory.
- `capacitor-index.html` — The HTML entry point for the Capacitor build (separate from the Lovable `public/index.html`).
- `src/lib/remove.functions.ts` — The AI object removal function, converted from a server function to a client-side function that calls the Lovable AI gateway directly.

## API Key

The app requires a `VITE_LOVABLE_API_KEY` environment variable to call the Lovable AI gateway for object removal. Set this in a `.env` file before building.

**Note:** The API key is embedded in the APK. For production use, consider routing AI requests through a backend proxy instead.
