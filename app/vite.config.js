import { defineConfig } from "vite";
import { resolve } from "node:path";

// Tauri expects a fixed dev port and serves the built files from dist/.
// Two pages: the overlay itself, and the see-through marker window.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), marker: resolve(import.meta.dirname, "marker.html") } },
  },
});
