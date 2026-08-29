/**
 * The names a check imports cross to the coder; what it asserts does not.
 *
 * This is the most frequent defect the machine records: a check fixes an
 * exact identifier, the coder is told the intent in prose and is blind to
 * the check, and in a typed language the two must agree on the spelling to
 * compile at all. The coder guesses, fails twice, and a supervisor reads
 * both sides and discloses the word — one worker session, every time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { namesBrief, namesTheChecksRequire } from "./contractNames";

function treeWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "names-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test("a coder is given the identifiers its checks import, and nothing they assert", async () => {
  const tree = treeWith({
    "src/surfaceLayout_AC-1.test.ts":
      `import { SURFACE_PAGES, type SurfacePage } from "./surfaceLayout";\n` +
      `import { unrelated } from "../elsewhere/other";\n` +
      `import assert from "node:assert/strict";\n` +
      `test("pages", () => assert.deepEqual(SURFACE_PAGES, ["write", "intent", "work", "sign"]));\n`,
  });

  const byFile = await namesTheChecksRequire({
    tree,
    probes: ["src/surfaceLayout_AC-1.test.ts"],
    owned: ["src/surfaceLayout.ts"],
  });

  assert.deepEqual(
    byFile.get("src/surfaceLayout.ts"),
    ["SURFACE_PAGES", "SurfacePage"],
    "the exact spellings, type imports included — a wrong one does not fail an assertion, it stops the check compiling",
  );
  assert.equal(byFile.size, 1, "only the coder's own files; a check's other imports are its business");

  const brief = namesBrief(byFile);
  assert.match(brief, /must export: SURFACE_PAGES, SurfacePage/);
  assert.equal(
    /write.*intent.*work.*sign/.test(brief),
    false,
    "what the check ASSERTS never crosses the wall — only what it calls things",
  );
});

test("a slice whose checks import nothing from it is told nothing", async () => {
  const tree = treeWith({
    "src/thing_AC-1.test.ts": `import { runIt } from "../harness/run";\ntest("x", () => runIt());\n`,
  });
  const byFile = await namesTheChecksRequire({
    tree,
    probes: ["src/thing_AC-1.test.ts"],
    owned: ["src/thing.ts"],
  });
  assert.equal(byFile.size, 0);
  assert.equal(namesBrief(byFile), "", "no paragraph, rather than an empty heading");
});
