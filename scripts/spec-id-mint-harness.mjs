#!/usr/bin/env node
/**
 * Harness for SP-7_SL-2 — base36-epoch Spec-id minting.
 *
 * Exercises ThinkubeStore.nextSpecNumber directly (it no longer reads the
 * filesystem) through the MCP vscode stub, proving: the id is base36, decodes
 * to ~now (epoch-derived, not max+1 → no allocator), and back-to-back mints are
 * distinct (monotonic per writer). (AC #1, #2, #3.)
 *
 * Build first: `npm run compile`. Run: `node scripts/spec-id-mint-harness.mjs`.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const require = createRequire(import.meta.url);
require(path.join(REPO, "dist", "mcp", "installVscodeStub.js")); // vscode hook
const { ThinkubeStore } = require(
  path.join(REPO, "dist", "store", "ThinkubeStore.js"),
);

const checks = [];
const record = (label, pass, detail) => {
  checks.push({ label, pass });
  console.log(`${pass ? "  ✅" : "  ❌"} ${label}`);
  if (detail) console.log(`        ${detail}`);
};

console.log("\nharness — SP-7_SL-2 base36-epoch Spec ids\n");

// Two different stores (different repos) — the id must not depend on the repo's
// filesystem (no allocator), and must stay distinct (monotonic guard).
const a = await new ThinkubeStore("/tmp/mint-a").nextSpecNumber();
const b = await new ThinkubeStore("/tmp/mint-b").nextSpecNumber();
const c = await new ThinkubeStore("/tmp/mint-a").nextSpecNumber();

record(
  "mints a base36 string id (not a consecutive integer)",
  /^[0-9a-z]+$/.test(a) && Number(a).toString() !== a,
  `a=${a}`,
);
const decoded = parseInt(a, 36);
const now = Math.floor(Date.now() / 1000);
record(
  "the id decodes to ~now (epoch-derived, no max+1 allocator) — AC #2",
  Number.isFinite(decoded) && Math.abs(decoded - now) <= 5,
  `decoded=${decoded} now=${now}`,
);
record(
  "back-to-back mints are distinct — monotonic per writer (AC #3)",
  a !== b && b !== c && a !== c,
  `a=${a} b=${b} c=${c}`,
);

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} behaviours held\n`);
process.exit(passed === checks.length ? 0 : 1);
