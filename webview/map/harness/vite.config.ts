/** Bundles the button-table harness for node (see buttons.tsx). */
import { defineConfig } from "vite";
import * as path from "node:path";

export default defineConfig({
  build: {
    ssr: path.resolve(__dirname, "buttons.tsx"),
    outDir: path.resolve(__dirname, "..", "..", "..", "out-test", "harness"),
    emptyOutDir: true,
    rollupOptions: { output: { format: "cjs", entryFileNames: "buttons.cjs" } },
  },
  ssr: { noExternal: true },
});
