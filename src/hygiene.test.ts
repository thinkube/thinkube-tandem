/**
 * Repository hygiene gates: no orphaned code (knip) and no giant modules
 * outside the fidelity-checked engine import. Both are build failures,
 * not review habits.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const repo = path.resolve(__dirname, "..");

test("knip: every file, export and dependency is reachable", async () => {
  const out = await new Promise<{ code: number; text: string }>((resolve) => {
    execFile(
      "npx",
      ["knip", "--no-progress"],
      { cwd: repo, encoding: "utf8", timeout: 180_000 },
      (err, stdout, stderr) =>
        resolve({
          code: err && typeof (err as { code?: number }).code === "number" ? (err as { code?: number }).code! : err ? 1 : 0,
          text: `${stdout}\n${stderr}`,
        }),
    );
  });
  assert.equal(out.code, 0, `orphaned code:\n${out.text}`);
});

const SIZE_LIMIT = 600;

test(`module size: no new file exceeds ${SIZE_LIMIT} lines (imported engine exempt)`, () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
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

function walkTs(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
  };
  walk(root);
  return out;
}

test("§7bis grep-gate: no code reads the first workspace folder", () => {
  const banned = /workspaceFolders\?\.\[0\]|workspaceFolders!\[0\]|workspaceFolders\[0\]/;
  // The imported engine host is legacy-exempt (ENGINE-CHANGE.md rules);
  // v2's own code is what the gate guards.
  const offenders: string[] = [];
  for (const f of walkTs("src"))
    if (!f.startsWith(path.join("src", "engine", "host")) && banned.test(fs.readFileSync(f, "utf8")))
      offenders.push(f);
  assert.deepEqual(offenders, [], "an explicit picker is the only door to a folder");
});
