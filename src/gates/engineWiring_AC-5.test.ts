/**
 * Run against the real source tree, the set of engine modules with no product
 * caller and the set of modules listed in ENGINE-WIRING.md are equal, and a
 * mismatch names both the modules missing from the ledger and the ledger
 * entries that are no longer unreached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { unreachedEngineModules, parseWiringLedger, type RepoFile } from "./engineWiring";

/** These tests run from the compiled `out-test/` tree, which mirrors `src/`,
 *  so the repo root is two levels up from this module's directory. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_EXT_RE = /\.tsx?$/;

function pathOf(m: string | { path: string }): string {
  return typeof m === "string" ? m : m.path;
}

function walk(dir: string, out: RepoFile[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "out" || name === "out-test" || name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!SOURCE_EXT_RE.test(name)) continue;
    out.push({
      path: path.relative(REPO_ROOT, full).split(path.sep).join("/"),
      content: readFileSync(full, "utf8"),
    });
  }
}

test("real tree: ENGINE-WIRING.md is complete against the current scan", () => {
  const files: RepoFile[] = [];
  walk(path.join(REPO_ROOT, "src"), files);
  walk(path.join(REPO_ROOT, "webview"), files);

  const scanned = new Set(unreachedEngineModules({ entry: "src/extension.ts", files }).map(pathOf));

  const result = parseWiringLedger(readFileSync(path.join(REPO_ROOT, "ENGINE-WIRING.md"), "utf8"));
  const entries = Array.isArray(result) ? result : result.entries;
  const problems = Array.isArray(result)
    ? []
    : ((result as any).errors ?? (result as any).problems ?? []);

  assert.equal(
    problems.length,
    0,
    `ENGINE-WIRING.md has unparseable entries: ${JSON.stringify(problems)}`,
  );

  const listed = new Set(entries.map((e) => e.path));
  const missingFromLedger = [...scanned].filter((p) => !listed.has(p));
  const staleInLedger = [...listed].filter((p) => !scanned.has(p));

  assert.deepEqual(
    missingFromLedger,
    [],
    `unreached engine modules missing from ENGINE-WIRING.md: ${missingFromLedger.join(", ")}`,
  );
  assert.deepEqual(
    staleInLedger,
    [],
    `ENGINE-WIRING.md entries no longer unreached (now wired): ${staleInLedger.join(", ")}`,
  );
});
