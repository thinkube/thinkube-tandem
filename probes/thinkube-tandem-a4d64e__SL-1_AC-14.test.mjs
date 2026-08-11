// WHY (TRANSITION): the DECISIONS.md docs-obligation bullet must state the
// new cut-level default (required by default, waived only by an explicit
// reason) — superseding the old "derives from grounding" wording. Proves
// the ledger entry itself was rewritten; done once that edit lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const decisions = fs.readFileSync(path.join(__dirname, "..", "DECISIONS.md"), "utf8");
const lower = decisions.toLowerCase();

test("the docs-obligation bullet states the cut-level default and the reason-carrying waiver", () => {
  assert.doesNotMatch(
    lower,
    /the docs obligation derives from grounding/,
    "the superseded 'derives from grounding' sentence is gone",
  );
  assert.match(lower, /default/, "the entry states documentation is required by default");
  assert.match(lower, /reason/, "the entry states the waiver carries a reason");
});
