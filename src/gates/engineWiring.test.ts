/**
 * The engine-wiring reachability gate: which `src/engine/` modules the
 * product never reaches (transitively, from `src/extension.ts`), and the
 * ledger (`ENGINE-WIRING.md`) that must name exactly that set, each entry
 * carrying a closed verdict and a non-empty reasoning sentence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { unreachedEngineModules, parseWiringLedger } from "./engineWiring";

const repo = path.resolve(__dirname, "..", "..");

// Synthetic source text is assembled from parts so no substring in this file
// reads, to a naive scanner, as a real relative import — these strings are
// pure data handed to the function under test, not this file's own module
// graph.
const IMPORT_KEYWORD = ["im", "port"].join("");
const FROM_KEYWORD = "from";
function importLine(names: string, specifier: string): string {
  return `${IMPORT_KEYWORD} { ${names} } ${FROM_KEYWORD} "${specifier}";\n`;
}

test("unreachedEngineModules returns an engine module only a test file imports, and not one a product module imports", () => {
  const files = [
    { path: "src/extension.ts", content: importLine("wired", "./engine/wired") },
    { path: "src/engine/wired.ts", content: "export function wired() {}\n" },
    { path: "src/engine/orphan.ts", content: "export function orphan() {}\n" },
    {
      path: "src/engine/orphan.test.ts",
      content: importLine("orphan", "./orphan") + 'test("x", () => orphan());\n',
    },
  ];
  const unreached = unreachedEngineModules({ files, productEntry: "src/extension.ts" });
  assert.ok(unreached.includes("src/engine/orphan.ts"), "a module only a test file imports is unreached");
  assert.ok(!unreached.includes("src/engine/wired.ts"), "a module the product imports is never reported as unreached");
});

test("unreachedEngineModules follows reach transitively: a module imported only by an unreached module is itself unreached", () => {
  const files = [
    { path: "src/extension.ts", content: importLine("wired", "./engine/wired") },
    { path: "src/engine/wired.ts", content: "export function wired() {}\n" },
    // Nothing product-side imports "middle" — only "leaf" imports it, and
    // "leaf" is itself unreached from the product.
    { path: "src/engine/middle.ts", content: "export function middle() {}\n" },
    {
      path: "src/engine/leaf.ts",
      content: importLine("middle", "./middle") + "export function leaf() { return middle(); }\n",
    },
    {
      path: "src/engine/leaf.test.ts",
      content: importLine("leaf", "./leaf") + 'test("x", () => leaf());\n',
    },
  ];
  const unreached = unreachedEngineModules({ files, productEntry: "src/extension.ts" });
  assert.ok(unreached.includes("src/engine/leaf.ts"), "leaf is imported only by a test, so it is unreached");
  assert.ok(
    unreached.includes("src/engine/middle.ts"),
    "middle is imported only by leaf, an unreached module — reach does not pass through it",
  );
  assert.ok(!unreached.includes("src/engine/wired.ts"), "wired is imported directly by the product entry");
});

test("parseWiringLedger returns one entry per listed module carrying its verdict, and refuses a verdict outside wire, retire and fold with a named reason rather than throwing", () => {
  const md = [
    "# Engine wiring",
    "",
    "- `src/engine/verificationRunnable.ts` — wire: arms when the run-plan gate",
    "  reads it to check a slice's declared test command is runnable.",
    "- `src/engine/retiredSymbolFootprint.ts` — retire: arms the day grounding",
    "  grows a retires declaration, as DECISIONS.md already records.",
    "",
  ].join("\n");
  const result = parseWiringLedger(md);
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.entries.length, 2);
  const byModule = new Map(result.entries.map((e) => [e.module, e]));
  assert.equal(byModule.get("src/engine/verificationRunnable.ts")?.verdict, "wire");
  assert.equal(byModule.get("src/engine/retiredSymbolFootprint.ts")?.verdict, "retire");

  const bad = [
    "# Engine wiring",
    "",
    "- `src/engine/mystery.ts` — maybe-later: nobody has decided what this does yet.",
    "",
  ].join("\n");
  let refused: ReturnType<typeof parseWiringLedger> | undefined;
  assert.doesNotThrow(() => {
    refused = parseWiringLedger(bad);
  });
  assert.equal(refused!.ok, false);
  if (refused!.ok) return;
  assert.ok(refused!.reason.length > 0, "the refusal names a reason");
  assert.ok(
    /mystery\.ts/.test(refused!.reason) || /maybe-later/.test(refused!.reason),
    "the reason names the offending entry or verdict",
  );
});

test("parseWiringLedger reports an entry whose reasoning sentence is missing or empty", () => {
  const missing = parseWiringLedger(["# Engine wiring", "", "- `src/engine/bare.ts` — wire", ""].join("\n"));
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.ok(missing.reason.length > 0, "the refusal names a reason");
  assert.match(missing.reason, /bare\.ts/, "the reason names the entry missing its reasoning sentence");

  const blank = parseWiringLedger(["# Engine wiring", "", "- `src/engine/blank.ts` — fold:", "  ", ""].join("\n"));
  assert.equal(blank.ok, false);
  if (blank.ok) return;
  assert.ok(blank.reason.length > 0, "the refusal names a reason");
  assert.match(blank.reason, /blank\.ts/, "the reason names the entry whose reasoning sentence is empty");
});

function loadRepoTsFiles(): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name))
        out.push({ path: path.relative(repo, p).split(path.sep).join("/"), content: fs.readFileSync(p, "utf8") });
    }
  };
  walk(path.join(repo, "src"));
  return out;
}

test("run against the real source tree: the set of engine modules with no product caller equals the set listed in ENGINE-WIRING.md — a mismatch names both what is missing from the ledger and what is no longer unreached", () => {
  const files = loadRepoTsFiles();
  const unreached = new Set(unreachedEngineModules({ files, productEntry: "src/extension.ts" }));

  const ledgerText = fs.readFileSync(path.join(repo, "ENGINE-WIRING.md"), "utf8");
  const parsed = parseWiringLedger(ledgerText);
  assert.ok(parsed.ok, parsed.ok ? "" : `ENGINE-WIRING.md failed to parse: ${parsed.reason}`);
  if (!parsed.ok) return;
  const listed = new Set(parsed.entries.map((e) => e.module));

  const missingFromLedger = [...unreached].filter((m) => !listed.has(m));
  const noLongerUnreached = [...listed].filter((m) => !unreached.has(m));

  assert.deepEqual(missingFromLedger, [], `unreached engine modules missing from ENGINE-WIRING.md: ${missingFromLedger.join(", ")}`);
  assert.deepEqual(noLongerUnreached, [], `ENGINE-WIRING.md entries no longer unreached (a product caller now reaches them): ${noLongerUnreached.join(", ")}`);
});

test("every entry in the real ENGINE-WIRING.md parses to a verdict drawn from wire, retire or fold and a non-empty reasoning sentence", () => {
  const ledgerText = fs.readFileSync(path.join(repo, "ENGINE-WIRING.md"), "utf8");
  const parsed = parseWiringLedger(ledgerText);
  assert.ok(parsed.ok, parsed.ok ? "" : `ENGINE-WIRING.md failed to parse: ${parsed.reason}`);
  if (!parsed.ok) return;
  assert.ok(parsed.entries.length > 0, "the ledger lists at least one module");
  const CLOSED = new Set(["wire", "retire", "fold"]);
  for (const entry of parsed.entries) {
    assert.ok(CLOSED.has(entry.verdict), `${entry.module} carries verdict "${entry.verdict}", not one of wire, retire, fold`);
    assert.ok(entry.reason.trim().length > 0, `${entry.module} carries an empty or missing reasoning sentence`);
  }
});
