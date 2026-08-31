/**
 * TRANSITION — this work must split every file it pushed past the
 * repository's own reading-size limit (src/run/gate.ts, src/run/dispatch.ts,
 * src/surfaces/session.ts, src/extension.ts) so the limit still holds once
 * this work lands. This drives the repository's existing module-size rule
 * (see src/hygiene.test.ts) unchanged — the same walk, the same 600-line
 * limit — as its own standing check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const repo = path.resolve(__dirname, "..", "..");
const SIZE_LIMIT = 600;

test(`no .ts or .tsx file under src or webview/map/src exceeds ${SIZE_LIMIT} lines`, () => {
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
  assert.deepEqual(offenders, [], "every file, including the four this work pushed past the limit, is split under it");
});
