import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Settings for Tauri: fixed port, no screen clear, and a build target that the system webview supports.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Rust builds (app and plugins) and the test data write many files. The dev server must not reload for them.
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/plugins/**", "**/data/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    // Two pages: the app, and the floating subtitle window.
    rollupOptions: { input: { main: "index.html", subtitle: "subtitle.html" } },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
