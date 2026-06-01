/**
 * Vite config for the kanban webview.
 *
 * Outputs into the extension's `media/kanban/` so the host code at
 * `src/views/kanban/host/Panel.ts` can resolve assets via `webview.asWebviewUri`.
 *
 * - Single-file output: we want predictable filenames (`assets/index.js`,
 *   `assets/index.css`) the host can stitch into the webview HTML directly.
 * - Public path is left as `./` and the host rewrites every src/href via
 *   `webview.asWebviewUri()` at runtime — VS Code's CSP makes anything else
 *   harder than it's worth.
 * - The dev `vite preview` mode is not used; everything goes through `build`.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "../../media/kanban"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
