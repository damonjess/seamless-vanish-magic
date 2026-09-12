import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { renameSync } from "fs";
import { resolve } from "path";

/** Rename capacitor-index.html to index.html in the build output */
const renameHtmlPlugin = (): Plugin => ({
  name: "rename-html",
  closeBundle() {
    const distDir = resolve(import.meta.dirname, "dist");
    try {
      renameSync(
        resolve(distDir, "capacitor-index.html"),
        resolve(distDir, "index.html"),
      );
    } catch {
      /* file may not exist if build failed */
    }
  },
});

/**
 * Vite config for building a static SPA for Capacitor (Android APK).
 *
 * This config is separate from the main vite.config.ts (which uses
 * @lovable.dev/vite-tanstack-config for SSR). It produces a client-only
 * build that Capacitor can bundle into the Android WebView.
 *
 * Usage:
 *   npm run build:capacitor:web   # build static assets to dist/
 *   npm run android:sync          # build + sync to Android project
 *   npm run android:open          # sync + open in Android Studio
 */
export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss(), tsConfigPaths(), renameHtmlPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "capacitor-index.html",
    },
  },
});
