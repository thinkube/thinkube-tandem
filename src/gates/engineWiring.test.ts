/**
 * Engine wiring gate: unit scenarios on synthetic file maps for
 * `unreachedEngineModules` / `parseWiringLedger`, plus the real-tree check
 * that keeps ENGINE-WIRING.md complete against the current scan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import {
  unreachedEngineModules,
  parseWiringLedger,
  type RepoFile,
} from "./engineWiring";

/** The repository root. These tests run from the compiled `out-test/` tree,
 *  so any read of authored source must resolve against the repo, never
 *  against the directory this module was loaded from.
 *
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function pathOf(m: string | { path: string }): string {
  return typeof m === "string" ? m : m.path;
}

test("unreachedEngineModules: a module only a test file imports is unreached", () => {
  const files: RepoFile[] = [
    { path: "src/extension.ts", content: `import { wired } from "./engine/wired";` },
    { path: "src/engine/wired.ts", content: `export const wired = 1;` },
    { path: "src/engine/orphan.ts", content: `export const orphan = 1;` },
    {
      path: "src/engine/orphan.test.ts",
      content: `import { orphan } from "./orphan";`,
    },
  ];
  const unreached = unreachedEngineModules({ entry: "src/extension.ts", files }).map(pathOf);
  assert.ok(unreached.includes("src/engine/orphan.ts"));
  assert.ok(!unreached.includes("src/engine/wired.ts"));
});

test("unreachedEngineModules: reach is transitive from the product entry", () => {
  const files: RepoFile[] = [
    {
      path: "src/extension.ts",
      content: `import { top } from "./engine/top";`,
    },
    {
      path: "src/engine/top.ts",
      content: `import { mid } from "./mid";\nexport const top = mid;`,
    },
    { path: "src/engine/mid.ts", content: `export const mid = 1;` },
  ];
  const unreached = unreachedEngineModules({ entry: "src/extension.ts", files }).map(pathOf);
  assert.ok(!unreached.includes("src/engine/top.ts"));
  assert.ok(!unreached.includes("src/engine/mid.ts"));
});

test("unreachedEngineModules: reach does not launder through an unreached module", () => {
  const files: RepoFile[] = [
    { path: "src/extension.ts", content: `export const entry = 1;` },
    {
      path: "src/engine/a.ts",
      content: `import { b } from "./b";\nexport const a = b;`,
    },
    { path: "src/engine/b.ts", content: `export const b = 1;` },
  ];
  const unreached = unreachedEngineModules({ entry: "src/extension.ts", files }).map(pathOf);
  assert.ok(unreached.includes("src/engine/a.ts"));
  assert.ok(
    unreached.includes("src/engine/b.ts"),
    "b is imported only by the unreached a.ts, so b must be reported unreached too",
  );
});

test("parseWiringLedger: one entry per listed module, and an unknown verdict is a named problem, not a throw", () => {
  const md = [
    "- `src/engine/foo.ts` — **wire**: arms the day the run command dispatches it.",
    "- `src/engine/bar.ts` — **retire**: no consumer remains after the v1 pipeline removal.",
    "- `src/engine/baz.ts` — **maybe**: unclear yet.",
  ].join("\n");

  const result = parseWiringLedger(md);
  assert.doesNotThrow(() => parseWiringLedger(md));

  const entries = Array.isArray(result) ? result : result.entries;
  assert.equal(entries.length, 2);
  const foo = entries.find((e) => e.path === "src/engine/foo.ts");
  const bar = entries.find((e) => e.path === "src/engine/bar.ts");
  assert.equal(foo?.verdict, "wire");
  assert.equal(bar?.verdict, "retire");

  const problems = Array.isArray(result)
    ? []
    : ((result as any).errors ?? (result as any).problems ?? []);
  const bazEntry = entries.find((e) => e.path === "src/engine/baz.ts");
  const bazFlagged =
    (bazEntry !== undefined &&
      ((bazEntry as any).error || (bazEntry as any).problem || (bazEntry as any).invalid)) ||
    problems.some((p: any) =>
      (typeof p === "string" ? p : `${p.path ?? ""} ${p.reason ?? ""}`).includes(
        "src/engine/baz.ts",
      ),
    );
  assert.ok(bazFlagged, "an unrecognized verdict must be reported as a problem, not silently accepted");
});

test("parseWiringLedger: a missing or blank reasoning sentence is flagged", () => {
  const md = "- `src/engine/quux.ts` — **fold**: ";
  const result = parseWiringLedger(md);
  const entries = Array.isArray(result) ? result : result.entries;
  const quux = entries.find((e) => e.path === "src/engine/quux.ts");
  const problems = Array.isArray(result)
    ? []
    : ((result as any).errors ?? (result as any).problems ?? []);
  const flagged =
    (quux !== undefined &&
      ((quux as any).error || (quux as any).problem || (quux as any).invalid)) ||
    problems.some((p: any) =>
      (typeof p === "string" ? p : `${p.path ?? ""} ${p.reason ?? ""}`).includes(
        "src/engine/quux.ts",
      ),
    );
  assert.ok(flagged, "a blank reasoning sentence must be flagged, never accepted as complete");
});

test("parseWiringLedger: a fully valid entry parses to a clean verdict and reason with no problems", () => {
  const md =
    "- `src/engine/clean.ts` — **wire**: arms the day the dispatcher calls it directly.";
  const result = parseWiringLedger(md);
  const entries = Array.isArray(result) ? result : result.entries;
  const problems = Array.isArray(result)
    ? []
    : ((result as any).errors ?? (result as any).problems ?? []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].verdict, "wire");
  assert.ok(entries[0].reason.trim().length > 0);
  assert.equal(problems.length, 0);
});

test("engineWiring.ts imports no Node I/O, no vscode, no model client, and its header declares that contract", () => {
  const gatesDir = path.join(REPO_ROOT, "src", "gates");
  const modulePath = path.join(gatesDir, "engineWiring.ts");
  assert.ok(
    statSync(modulePath, { throwIfNoEntry: false }),
    `the module this check reads is not in the tree it is run against.\n` +
      `root: ${REPO_ROOT}\n` +
      `src/gates holds: ${(readdirSync(gatesDir, { withFileTypes: true }) ?? []).map((d) => d.name).join(", ")}\n` +
      `root holds: ${readdirSync(REPO_ROOT).join(", ")}`,
  );
  const src = readFileSync(modulePath, "utf8");
  const importLines = src
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l) || /^\s*export\s+\*\s+from/.test(l));
  const forbidden = /["'](fs|node:fs|path|node:path|https?|node:https?|child_process|node:child_process|vscode)(\/|["'])/;
  for (const line of importLines) {
    assert.doesNotMatch(line, forbidden, `forbidden import: ${line}`);
  }
  assert.doesNotMatch(src, /from ["']vscode["']/);
  assert.match(
    src,
    /no.?I\/?O|no disk read/i,
    "header must state the no-I/O contract",
  );
  assert.match(src, /vscode/i, "header must mention the no-vscode contract");
  assert.match(src, /model/i, "header must mention the no-model-client contract");
});

// --- Real tree: ENGINE-WIRING.md stays complete against the current scan ---

const SOURCE_EXT_RE = /\.tsx?$/;

function walk(dir: string, out: RepoFile[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "out" || name === "out-test" || name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!SOURCE_EXT_RE.test(name)) continue;
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join("/");
    out.push({ path: rel, content: readFileSync(full, "utf8") });
  }
}

test("real tree: ENGINE-WIRING.md is complete against the current scan", () => {
  const files: RepoFile[] = [];
  walk(path.join(REPO_ROOT, "src"), files);
  walk(path.join(REPO_ROOT, "webview"), files);

  const scanned = new Set(
    unreachedEngineModules({ entry: "src/extension.ts", files }).map(pathOf),
  );

  const ledgerText = readFileSync(path.join(REPO_ROOT, "ENGINE-WIRING.md"), "utf8");
  const ledgerResult = parseWiringLedger(ledgerText);
  const ledgerEntries = Array.isArray(ledgerResult) ? ledgerResult : ledgerResult.entries;
  const ledgerProblems = Array.isArray(ledgerResult)
    ? []
    : ((ledgerResult as any).errors ?? (ledgerResult as any).problems ?? []);

  assert.equal(
    ledgerProblems.length,
    0,
    `ENGINE-WIRING.md has unparseable entries: ${JSON.stringify(ledgerProblems)}`,
  );

  const listed = new Set(ledgerEntries.map((e) => e.path));

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

  for (const entry of ledgerEntries) {
    assert.ok(
      entry.verdict === "wire" || entry.verdict === "retire" || entry.verdict === "fold",
      `${entry.path} carries an invalid verdict "${entry.verdict}"`,
    );
    assert.ok(
      entry.reason.trim().length > 0,
      `${entry.path} carries an empty reasoning sentence`,
    );
  }
});
