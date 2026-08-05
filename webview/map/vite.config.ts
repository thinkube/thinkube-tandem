import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../../media/map",
    emptyOutDir: true,
    sourcemap: true,
  },
});
