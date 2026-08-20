// WHY (INVARIANT): every ledger entry must carry a non-empty reasoning
// sentence saying why its verdict holds — a verdict with no reason, or a
// blank one, is a placeholder decision, and parseWiringLedger must report
// it rather than let a silently-unreasoned entry pass as valid.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseWiringLedger } from "../out-test/gates/engineWiring.js";

test("parseWiringLedger reports an entry whose reasoning sentence is missing", () => {
  const md = ["# Engine wiring", "", "- `src/engine/bare.ts` — wire", ""].join("\n");
  const result = parseWiringLedger(md);
  assert.equal(result.ok, false);
  assert.ok(
    typeof result.reason === "string" && result.reason.length > 0,
    "the refusal names a reason",
  );
  assert.ok(
    /bare\.ts/.test(result.reason),
    "the reason names the entry missing its reasoning sentence",
  );
});

test("parseWiringLedger reports an entry whose reasoning sentence is empty (blank after the verdict)", () => {
  const md = ["# Engine wiring", "", "- `src/engine/blank.ts` — fold:", "  ", ""].join("\n");
  const result = parseWiringLedger(md);
  assert.equal(result.ok, false);
  assert.ok(
    typeof result.reason === "string" && result.reason.length > 0,
    "the refusal names a reason",
  );
  assert.ok(
    /blank\.ts/.test(result.reason),
    "the reason names the entry whose reasoning sentence is empty",
  );
});
