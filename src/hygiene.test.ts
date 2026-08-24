/**
 * Two rules about the shape of this repository itself: nothing grows past
 * reading size, and nothing is kept that nothing reaches.
 *
 * The size limit exists because files here once reached five
 * thousand lines.
 *
 * It briefly withheld a delivery of unrelated work, and my answer was to
 * delete it — which would have let the files grow back. The rule was never
 * the problem: the files were. They are split now, so it holds again, and
 * the next fix is to refuse the write that breaks it rather than to
 * discover it at the gate, when the only actor left is a closer under
 * pressure with the whole tree in front of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { gatedActions } from "./surfaces/phase";

// __dirname is this compiled test's own directory under out-test/src/…,
// mirroring its source location under src/ — one more ".." than the
// source's own depth reaches the repository root from there.
const repo = path.resolve(__dirname, "..", "..");
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

test("nothing in this repository is unreachable from the product's own entry points", () => {
  // The gate was off because its old configuration used TEST files as entry
  // points, which made it a coverage gate wearing a reachability gate's
  // name: anything a test imported counted as reached. With the product's
  // real entry point it says something true — and the day it went back on it
  // found four files and sixty-two exports that nothing reached, all of them
  // kept alive by tests that no longer exist.
  // A finding is a non-zero exit, which execFileSync throws on: the finding
  // itself is on the error's stdout, and a reader needs to see it rather
  // than the words "command failed".
  let out = "";
  try {
    out = execFileSync("npx", ["knip", "--no-progress"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    out = String((err as { stdout?: string }).stdout ?? err).trim();
  }
  assert.equal(out, "", `unreachable code:\n${out}`);
});

test("every shaping action the surface can send is gated by a phase", () => {
  // A control's action lives in two places that must agree: the surface's
  // own list of what is shaping, and the phase table that says when the
  // host acts on it. They fail in opposite directions and neither speaks —
  // an action absent from the table is refused in NO phase and enabled in
  // none either, so the host always acts on it and its button is dead
  // forever. A unit that built a new control found this from the inside,
  // could not fix it (the table is not its to write), edited it anyway,
  // and the guard ended it.
  const src = fs.readFileSync(path.join(repo, "webview", "map", "src", "vscode.ts"), "utf8");
  const block = /const SHAPING = new Set\(\[([\s\S]*?)\]\)/.exec(src);
  assert.ok(block, "the surface no longer declares which actions are shaping");
  const shaping = [...block[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
  const gated = gatedActions().sort();
  assert.deepEqual(
    shaping.filter((a) => !gated.includes(a)),
    [],
    "the surface can send these, and no phase governs them",
  );
  assert.deepEqual(
    gated.filter((a) => !shaping.includes(a)),
    [],
    "the phase table governs these, and the surface never sends them",
  );
});
