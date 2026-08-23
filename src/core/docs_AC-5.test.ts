/**
 * The run's docs gate calls isDocPath rather than testing a `docs/` prefix
 * itself, and both gates agree on the same set of paths for a slice's files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { isDocPath, docLandings } from "./docs";
import type { Space } from "./schema";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("the run's docs gate calls isDocPath rather than testing a docs/ prefix itself", () => {
  const src = readFileSync(path.join(REPO_ROOT, "src", "run", "plan.ts"), "utf8");
  assert.match(
    src,
    /\bisDocPath\b/,
    "src/run/plan.ts must call isDocPath — the one rule for what counts as documentation",
  );
  // The gate must not re-implement the rule locally. Any literal `docs/`
  // prefix test in the module would be a second, driftable reading of it.
  const codeOnly = src
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
  assert.doesNotMatch(
    codeOnly,
    /startsWith\(\s*["'`]docs\//,
    "the run's docs gate must not test a docs/ prefix itself — it must ask isDocPath",
  );
});

test("both gates agree on the same set of paths for a slice's files", () => {
  const files = [
    "src/widget.ts",
    "docs/modules/ROOT/pages/widget.adoc",
    "docs/TERMINOLOGY.md",
    "src/gates/sign.ts",
    "README.md",
  ];

  // The sign gate's reading, through the cut's grounded members.
  const space = {
    asks: [],
    nodes: files.map((p, i) => ({
      id: `n${i}`,
      sentence: `touches ${p}`,
      serves: [],
      needs: [],
      grounding: { touchpoints: [{ path: p }], stamp: [] },
      acceptance: [{ id: `c${i}`, text: "checked" }],
    })),
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  } as unknown as Space;

  const signGateDocs = new Set(
    docLandings(space, { id: "c1", changeIds: files.map((_, i) => `n${i}`) }),
  );
  const runGateDocs = new Set(files.filter(isDocPath));

  assert.deepEqual(
    [...signGateDocs].sort(),
    [...runGateDocs].sort(),
    "the sign gate and the run's docs gate must classify a slice's files identically",
  );
});
