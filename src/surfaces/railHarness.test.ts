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
 * The harness output as JSON text. Builds the bundle if it is not there
 * yet — the extension's own `npm test` compiles `src` but does not run
 * vite, so a check must not assume the bundle already exists.
 */
export function renderedTable(repo: string, bundle: string): string {
  if (!fs.existsSync(bundle)) {
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
  try {
    return execFileSync("node", [bundle], { cwd: repo, encoding: "utf8" });
  } catch (err) {
    throw new Error(`the surface harness could not be run:\n${words(err)}`);
  }
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
