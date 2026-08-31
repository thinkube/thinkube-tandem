/** Bundles the button-table harness for node (see buttons.tsx). */
import { defineConfig } from "vite";
import * as path from "node:path";

export default defineConfig({
  build: {
    ssr: path.resolve(__dirname, "buttons.tsx"),
    outDir: path.resolve(__dirname, "..", "..", "..", "out-test", "harness"),
    emptyOutDir: true,
    // The bundle is what runs, but the webview's own files are what a
    // coverage reader must see executed: without a source map the lines
    // this harness drives are credited to buttons.cjs, and App.tsx reads
    // as never reached while it is in fact rendering on every call.
    sourcemap: true,
    rollupOptions: { output: { format: "cjs", entryFileNames: "buttons.cjs" } },
  },
  ssr: { noExternal: true },
});
