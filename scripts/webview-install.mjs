/**
 * Installs the surface's own dependencies.
 *
 * The surface is a separate npm package under webview/map with its own
 * react and vite. An install at the repository root does not reach it,
 * and nothing else does either, so on a clean checkout webview/map has no
 * node_modules: `vite build` cannot run, the harness bundle is never
 * produced, and every check that renders the surface dies in its own
 * setup. The extension's checks then report that no line of the surface
 * ran — which is true, and says nothing about the surface.
 *
 * Idempotent: with the tools already present this exits without running
 * an install, so the common case costs one directory check.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = path.join(repo, "webview", "map");

/** The binaries the surface's own build and harness invoke. */
const needed = ["vite", "tsc"];
const binDir = path.join(pkg, "node_modules", ".bin");
const missing = needed.filter((b) => !fs.existsSync(path.join(binDir, b)));

if (missing.length === 0) process.exit(0);

console.log(`installing the surface's dependencies (missing: ${missing.join(", ")})`);
try {
  execFileSync("npm", ["install", "--prefix", pkg, "--no-audit", "--no-fund"], {
    cwd: repo,
    stdio: "inherit",
  });
} catch {
  // The installer's own output already went to the terminal above. Exit
  // non-zero so the build stops here rather than failing later, deep in a
  // vite run, with an error that names a missing module instead of a
  // missing install.
  console.error("the surface's dependencies could not be installed");
  process.exit(1);
}
