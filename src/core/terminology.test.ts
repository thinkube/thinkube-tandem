/**
 * The vocabulary gate: retired v1 terms must not appear in source, UI
 * strings, package metadata or the README. docs/TERMINOLOGY.md is the one
 * place allowed to name them (it documents their retirement).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const repo = path.resolve(__dirname, "..", "..");

// Per the terminology decision records: TEP and slice are CANONICAL (the
// engine's vocabulary is the brand's); only these retire with their
// referents. Imported engine files (src/engine/**) are canonical speech
// and exempt.
const RETIRED: RegExp[] = [
  /\bThinky\b/i,
  /\bscratchpad\b/i,
  /\bkanban\b/i,
  /\bspec-prepare\b/i,
  /\bWorkOrder\b/,
];

function* walk(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    if (["node_modules", "out", "out-test", ".git"].includes(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|json|md)$/.test(name)) yield p;
  }
}

test("retired vocabulary appears nowhere outside TERMINOLOGY.md", () => {
  const offenders: string[] = [];
  for (const file of walk(repo)) {
    if (file.endsWith(path.join("docs", "TERMINOLOGY.md"))) continue;
    if (file.endsWith("terminology.test.ts")) continue;
    if (file.includes(path.join("src", "engine") + path.sep)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const term of RETIRED)
      if (term.test(text)) offenders.push(`${path.relative(repo, file)}: ${term}`);
  }
  assert.deepEqual(offenders, []);
});

test("the brand is spelled 'Thinkube Tandem' in package metadata", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repo, "package.json"), "utf8"),
  ) as { displayName?: string; name?: string; icon?: string };
  assert.equal(pkg.displayName, "Thinkube Tandem");
  assert.equal(pkg.name, "thinkube-tandem");
  assert.equal(pkg.icon, "icon.png");
  assert.ok(fs.existsSync(path.join(repo, "icon.png")), "the icon ships");
});
