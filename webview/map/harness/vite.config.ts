/** Bundles the button-table harness for node (see buttons.tsx). */
import { defineConfig } from "vite";
import * as path from "node:path";

export default defineConfig({
  build: {
    ssr: path.resolve(__dirname, "buttons.tsx"),
    outDir: path.resolve(__dirname, "..", "..", "..", "out-test", "harness"),
    emptyOutDir: true,
    // The bundle inlines its sources, so the only record of which original
    // file a run touched is the source map. Without it the surface modules
    // are executed under a single bundle path and attribute to nothing.
    sourcemap: true,
    rollupOptions: { output: { format: "cjs", entryFileNames: "buttons.cjs" } },
  },
  ssr: { noExternal: true },
});
