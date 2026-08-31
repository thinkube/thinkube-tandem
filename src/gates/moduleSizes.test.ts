/**
 * The shape of the modules is reported, and reporting is all it does.
 *
 * A ceiling on file length is satisfied by deleting the explanation rather
 * than extracting the code — the cheaper move and the worse one, and the one
 * that gets taken: four files were compressed instead of split in a single
 * afternoon under a six-hundred-line rule. Measured against the tree it
 * governed it moved little, and it could not see the thing it stood in for:
 * a module opening "execution locks, probe maps, the verification list, the
 * honesty scan, the delivery record, documentation obligations, and the
 * roles' invariant" is a bag at three hundred and sixty-two lines.
 *
 * So this counts, and says, and never refuses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sayShape, treeShape } from "./moduleSizes";

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-shape-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const CODE = (n: number): string => Array.from({ length: n }, (_, i) => `const x${i} = ${i};`).join("\n");
const SAID = (n: number): string => Array.from({ length: n }, () => "// a line that explains").join("\n");

test("explanation is never counted as size", async () => {
  const root = tree({ "src/a.ts": CODE(10), "src/b.ts": `${SAID(100)}\n${CODE(10)}` });
  const s = (await treeShape(root))!;
  assert.equal(s.code.max, 10, "a file is not larger for being explained");
  assert.equal(s.code.min, 10);
  assert.ok(s.explained > 70, "and how much of the tree explains is itself worth saying");
});

test("a block comment does not count, however long", async () => {
  const root = tree({ "src/a.ts": `/**\n${" * words\n".repeat(200)} */\n${CODE(3)}` });
  assert.equal((await treeShape(root))!.code.max, 3);
});

test("the largest are named, because they are the only ones anyone acts on", async () => {
  const root = tree({ "src/small.ts": CODE(5), "src/big.ts": CODE(90), "src/mid.ts": CODE(40) });
  const s = (await treeShape(root))!;
  assert.deepEqual(s.largest.map((f) => f.path), ["src/big.ts", "src/mid.ts", "src/small.ts"]);
  assert.equal(s.code.median, 40);
  assert.equal(s.files, 3);
});

test("checks answer for their own size, and built output is not source", async () => {
  const root = tree({
    "src/a.ts": CODE(5),
    "src/a.test.ts": CODE(500),
    "out/a.js": CODE(500),
    "node_modules/p/i.js": CODE(500),
  });
  const s = (await treeShape(root))!;
  assert.equal(s.files, 1, "one source file — a check, a build and a dependency are none of them");
});

test("an empty tree reports nothing rather than zeroes", async () => {
  assert.equal(await treeShape(tree({ "README.md": "hello" })), undefined);
});

test("what it says is context, and never a verdict", async () => {
  const said = sayShape((await treeShape(tree({ "src/a.ts": CODE(700) })))!).join("\n");
  assert.match(said, /Nothing here is a rule/);
  for (const word of ["exceed", "limit", "must", "violation", "too (big|large|long)", "failed"])
    assert.doesNotMatch(said, new RegExp(word, "i"), `"${word}" turns a report into a rule`);
});
