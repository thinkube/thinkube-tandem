/**
 * The surface's control table, rendered without a host — and the drive
 * that the render can be produced at all.
 *
 * The surface is TSX built by vite under its own rootDir, which the
 * extension's build cannot import. The harness bundles it for node; this
 * runs that bundle and hands back its JSON, for the checks that read the
 * table and the gestures.
 *
 * This lives in a test-shaped file on purpose: it is reached only from
 * checks, and a plain module reached only from checks is exactly what the
 * repository's reachability rule refuses to keep.
 *
 * A failure here speaks in the builder's own words. `execFileSync` throws
 * "Command failed" and puts the reason on the error's stdout/stderr, so a
 * reader would otherwise be told nothing about why the surface could not
 * be rendered — and a check that cannot render its subject must say so as
 * a failure, never pass quietly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

/** What a failed child process reported, in its own words. */
function words(err: unknown): string {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  return [e.stdout, e.stderr, e.message].map((s) => (s ?? "").toString().trim()).filter(Boolean).join("\n");
}

/**
 * Every source the bundle is built from, so staleness can be decided by
 * comparing their times against the bundle's.
 */
function harnessSources(repo: string): string[] {
  const roots = [
    path.join(repo, "webview", "map", "src"),
    path.join(repo, "webview", "map", "harness"),
    path.join(repo, "src", "surfaces"),
  ];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) found.push(full);
    }
  };
  for (const root of roots) if (fs.existsSync(root)) walk(root);
  return found;
}

/**
 * Whether the bundle predates any source it is built from. A bundle left
 * by an earlier round is the one way this drive can run the WRONG surface
 * and still be green: the checks would render code that no longer matches
 * the files the promise lands in, and report on a product that is not the
 * one in the tree. Rebuilding on staleness — not merely on absence — is
 * what makes "the real surface ran" true rather than likely.
 */
function stale(bundle: string, repo: string): boolean {
  if (!fs.existsSync(bundle)) return true;
  const built = fs.statSync(bundle).mtimeMs;
  return harnessSources(repo).some((f) => fs.statSync(f).mtimeMs > built);
}

/**
 * The harness output as JSON text. Builds the bundle when it is missing or
 * older than any source it is built from — the extension's own `npm test`
 * compiles `src` but does not run vite, so a check must neither assume the
 * bundle exists nor trust one an earlier round left behind.
 *
 * The bundle is LOADED HERE, in this process, never spawned as a child.
 * Coverage instruments the process running the checks and nothing it
 * spawns, so a harness run with `execFileSync` executed the surface
 * modules somewhere nothing measured: every drive over its output was
 * green without a line of Rail.tsx or vscode.ts being seen to run, which
 * is as true for a stub as for the real surface. Loaded in-process the
 * same bundle runs the same code, and its source map — which the harness
 * build emits for exactly this reason — attributes those lines back to
 * the real `webview/map` files.
 *
 * The bundle is a CJS script that writes its JSON to stdout as it loads
 * and takes no argument, so stdout is captured across the load and the
 * module cache is cleared first: a second call must re-run the render,
 * not return an empty string because the module was already loaded.
 */
export function renderedTable(repo: string, bundle: string): string {
  if (stale(bundle, repo)) {
    // The surface is a separate npm package with its own react and vite; an
    // install at the repository root does not reach it. On a clean checkout
    // webview/map has no node_modules, so `vite build` cannot run and the
    // bundle is never produced. Installing first is what makes this build
    // possible at all rather than only when a previous run left the tools
    // behind.
    //
    // The install is skipped when the binaries the build invokes are already
    // present. It reaches the network, and a runner without one would
    // otherwise fail here even though every tool the build needs is on disk
    // — a failure about fetching packages, in a check about the surface.
    const bin = path.join(repo, "webview", "map", "node_modules", ".bin");
    if (!["vite", "tsc"].every((b) => fs.existsSync(path.join(bin, b)))) {
      try {
        execFileSync("node", [path.join(repo, "scripts", "webview-install.mjs")], {
          cwd: repo,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        throw new Error(
          `the surface's dependencies could not be installed, so the render cannot be read:\n${words(err)}`,
        );
      }
    }
    try {
      execFileSync("npm", ["run", "--prefix", path.join(repo, "webview", "map"), "buttons"], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      throw new Error(`the surface harness could not be built, so the render cannot be read:\n${words(err)}`);
    }
  }
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  // The harness reads argv[2] as an optional fixture of pushes. Run in
  // this process, argv[2] is whatever the test runner was given, which is
  // not a fixture — it is trimmed so the harness builds its pushes from
  // the host's own phase table, which is what every drive here expects.
  const realArgv = process.argv;
  process.argv = realArgv.slice(0, 2);
  (process.stdout as NodeJS.WriteStream).write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    delete require.cache[require.resolve(bundle)];
    require(bundle);
  } catch (err) {
    throw new Error(`the surface harness could not be run:\n${words(err)}`);
  } finally {
    (process.stdout as NodeJS.WriteStream).write = realWrite;
    process.argv = realArgv;
  }
  return chunks.join("");
}

const repo = path.resolve(__dirname, "..", "..");
const bundle = path.join(repo, "out-test", "harness", "buttons.cjs");

// INVARIANT: the render can be produced, and it is a table keyed by phase.
// Every other surface check reads this; if it cannot be built, they should
// fail for that stated reason rather than for a shapeless parse error.
test("the surface renders to a control table without a host", () => {
  const table = JSON.parse(renderedTable(repo, bundle)) as Record<string, unknown>;
  assert.ok(table["understood"], "no controls rendered for the understood phase");
});
