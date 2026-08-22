/**
 * One hygiene gate: no module past the size at which it stops being read.
 *
 * Reachability (knip) is deliberately absent for now. Its old configuration
 * used the TEST FILES as entry points, so any export a test touched counted
 * as reachable — it measured test coverage of exports, not dead code, and
 * it quietly pushed a test to be written for every new export. Measured
 * from the product's real entries it reports 58 unused exports and 5 unused
 * files: a cleanup with decisions to make, not a gate to switch on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const repo = path.resolve(__dirname, "..");
const SIZE_LIMIT = 600;

test(`module size: no file exceeds ${SIZE_LIMIT} lines (the imported engine is exempt)`, () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (["node_modules", "out", "out-test", "media", "engine"].includes(name)) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name)) {
        const lines = fs.readFileSync(p, "utf8").split("\n").length;
        if (lines > SIZE_LIMIT) offenders.push(`${path.relative(repo, p)}: ${lines}`);
      }
    }
  };
  walk(path.join(repo, "src"));
  walk(path.join(repo, "webview", "map", "src"));
  assert.deepEqual(offenders, []);
});
