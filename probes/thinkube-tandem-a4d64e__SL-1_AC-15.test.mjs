// WHY (TRANSITION): gates.adoc must state the new rule on its face —
// documentation required of every cut — and describe the waiver gesture and
// its reason, replacing the old declared-touchpoint framing.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("gates.adoc says documentation is required of every cut and describes the waiver gesture and its reason", () => {
  const text = fs.readFileSync(path.join(process.cwd(), "docs/modules/ROOT/pages/gates.adoc"), "utf8");
  assert.ok(
    /required of every cut/i.test(text),
    "gates.adoc states documentation is required of every cut",
  );
  assert.ok(
    /waive|waiver/i.test(text) && /reason/i.test(text),
    "gates.adoc describes the waiver gesture and that it carries a reason",
  );
});
