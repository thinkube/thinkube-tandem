// WHY (TRANSITION): the register must state the new rule's two mechanics in
// writing — a reasonless waiver is refused at signing, and the reason that
// IS given is recorded in the TEP — so the rule is discoverable from the
// decisions record alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("the register states a reasonless waiver is refused at signing and the reason is recorded in the TEP", () => {
  const text = fs.readFileSync(path.join(process.cwd(), "DECISIONS.md"), "utf8");
  assert.ok(
    /waiver.*without a reason.*refused.*sign|reasonless waiver.*refused/i.test(text),
    "the register says a waiver without a reason is refused at signing",
  );
  assert.ok(
    /reason.*recorded.*TEP|TEP.*records.*reason/i.test(text),
    "the register says the reason is recorded in the TEP",
  );
});
