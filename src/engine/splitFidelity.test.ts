/**
 * The engine-split fidelity gate: the chunked core, reconstructed in order
 * with added imports removed and added export keywords stripped, must hash
 * to the archive original (minus its import block). Moves only — proven,
 * not promised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

test("orchestratorCore chunks reconstruct to the original hash", () => {
  const dir = path.join(__dirname, "..", "..", "src", "engine", "core");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "split-manifest.json"), "utf8"),
  ) as { originalHash: string; chunks: string[]; addedExports: string[] };
  const added = new Set(manifest.addedExports);
  const out: string[] = [];
  for (const chunk of manifest.chunks) {
    const lines = fs
      .readFileSync(path.join(dir, `${chunk}.ts`), "utf8")
      .split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    for (let ln of lines) {
      if (/^import /.test(ln)) continue;
      const m = /^export ((?:async )?(?:function|const|class|interface|type|enum) )(\w+)/.exec(ln);
      if (m && added.has(m[2])) ln = ln.slice("export ".length);
      out.push(ln.replace(/\s+$/, ""));
    }
  }
  const h = createHash("sha256").update(out.join("\n")).digest("hex");
  assert.equal(h, manifest.originalHash, "the split moved code — it must never change it");
});
