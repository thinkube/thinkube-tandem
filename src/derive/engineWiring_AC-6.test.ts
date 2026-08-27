/**
 * TRANSITION: ENGINE-WIRING.md is the derived ledger for this repository's
 * own src/ tree — every module unwiredEngineModules finds with no product
 * caller, over the repository's own files and its own knip.json entry
 * points, must appear as a row in ENGINE-WIRING.md. This test's job is
 * done once that ledger is written and kept in step with the tree it
 * describes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { unwiredEngineModules, parseWiringLedger } from "./engineWiring";

const repo = path.resolve(__dirname, "..", "..");

function collectRepoFiles(dir: string, base: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      if (["node_modules", "out", "out-test", "media"].includes(name)) continue;
      out.push(...collectRepoFiles(p, base));
    } else if (/\.tsx?$/.test(name)) {
      out.push({ path: path.relative(base, p).replace(/\\/g, "/"), content: fs.readFileSync(p, "utf8") });
    }
  }
  return out;
}

test("every module unwiredEngineModules finds in this repository's src/ tree is a row in ENGINE-WIRING.md", () => {
  const files = collectRepoFiles(path.join(repo, "src"), repo);
  const knip = JSON.parse(fs.readFileSync(path.join(repo, "knip.json"), "utf8")) as {
    workspaces: { ".": { entry: string[] } };
  };
  const unwired = unwiredEngineModules(files, knip.workspaces["."].entry);
  const ledgerText = fs.readFileSync(path.join(repo, "ENGINE-WIRING.md"), "utf8");
  const rows = parseWiringLedger(ledgerText);
  const ledgerModules = new Set(rows.map((r) => r.module));
  const missing = unwired.filter((m) => !ledgerModules.has(m));
  assert.deepEqual(missing, [], `unwired modules missing a ledger row: ${JSON.stringify(missing)}`);
});
