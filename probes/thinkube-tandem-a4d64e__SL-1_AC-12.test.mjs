// WHY (TRANSITION): the decisions register's old grounding-derived docs
// entry must no longer stand unqualified — it is superseded by the new
// per-cut default, so a reader of DECISIONS.md is not misled about which
// rule governs today.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test('the old "docs obligation derives from grounding" entry is superseded, not left standing alone', () => {
  const text = fs.readFileSync(path.join(process.cwd(), "DECISIONS.md"), "utf8");
  const oldLine = "The docs obligation derives from grounding: a slice declaring a docs/";
  assert.ok(text.includes(oldLine), "the original entry's text is still present for the historical record");
  // Superseded means a later, dated entry in the register states the new
  // per-cut default explicitly — searchable independent of the old line.
  assert.ok(
    /required of every cut/i.test(text),
    "the register states the new default: documentation required of every cut",
  );
  assert.ok(
    /supersede/i.test(text),
    "the register names the old grounding-derived entry as superseded, in writing",
  );
});
