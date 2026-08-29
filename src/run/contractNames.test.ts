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
import { briefWithInherited, namesBrief, namesTheChecksRequire } from "./contractNames";

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

/**
 * A tester inherits the tests already pinning the files it changes.
 *
 * The fuchsia band, and the person now asks for brilliant green. Nobody can
 * settle that by comparing words — the second ask may say "the header
 * background" and mean the same thing. What settles it is the code: the
 * old test pins the file this slice changes, so it reaches the tester,
 * which holds the criteria that overrule it.
 *
 * It has to be the tester. A coder may never touch a test, and the finisher
 * only arrives an hour later, after the run has been built on top.
 */
test("a tester is handed the tests pinning its files, and told what to do with each", async () => {
  const tree = treeWith({
    "src/card.ts": `export const band = () => "fuchsia";\n`,
    "src/cardColour.test.ts": `import { band } from "./card";\ntest("band", () => assert.equal(band(), "fuchsia"));\n`,
    "src/unrelated.test.ts": `import { other } from "./other";\ntest("other", () => other());\n`,
  });

  const brief = await briefWithInherited("BASE BRIEF", {
    role: "test",
    tree,
    files: ["src/card.ts"],
    tests: ["src/cardColour.test.ts", "src/unrelated.test.ts"],
  });

  assert.match(brief, /src\/cardColour\.test\.ts — pins behaviour of src\/card\.ts/);
  assert.equal(/unrelated/.test(brief), false, "a test that touches none of its files is not its business");
  assert.match(brief, /CONTRADICT what it pins/, "and it is told to judge against its own criteria");
  assert.match(brief, /ANOTHER unit of this same cut/, "including work a sibling unit did minutes ago");
});

test("a coder is never handed tests to reconcile", async () => {
  const tree = treeWith({
    "src/card.ts": `export const band = () => "fuchsia";\n`,
    "src/cardColour.test.ts": `import { band } from "./card";\ntest("band", () => assert.equal(band(), "fuchsia"));\n`,
  });
  const brief = await briefWithInherited("BASE BRIEF", {
    role: "code",
    tree,
    files: ["src/card.ts"],
    tests: ["src/cardColour.test.ts"],
  });
  assert.equal(brief, "BASE BRIEF", "tests are the tester's — a coder may not touch one");
});
