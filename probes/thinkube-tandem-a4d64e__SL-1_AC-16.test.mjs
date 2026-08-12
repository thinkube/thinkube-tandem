// WHY (TRANSITION): getting-started.adoc's cut-and-sign section must name
// the documentation decision as part of the cut screen, and name the
// reasonless-waiver refusal at signing — the walkthrough matches the new
// rule, not the old declared-touchpoint one.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("getting-started.adoc's cut-and-sign section names the documentation decision and the reasonless-waiver refusal", () => {
  const text = fs.readFileSync(path.join(process.cwd(), "docs/modules/ROOT/pages/getting-started.adoc"), "utf8");
  const sectionMatch = /== Cut and sign([\s\S]*?)(?=\n== |$)/.exec(text);
  assert.ok(sectionMatch, "the 'Cut and sign' section exists");
  const section = sectionMatch[1];
  assert.ok(
    /documentation/i.test(section),
    "the cut-and-sign section names the documentation decision as part of the cut screen",
  );
  assert.ok(
    /reason/i.test(section) && /refus/i.test(section),
    "the cut-and-sign section names the reasonless-waiver refusal at signing",
  );
});
