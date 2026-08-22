// WHY (INVARIANT): every ledger entry must carry a real, non-empty reasoning
// sentence — an entry whose "why" is missing or blank is a placeholder, not
// a verdict, and the reader must surface that rather than let it pass as
// complete. This must hold for as long as the ledger format exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWiringLedger } from "../out-test/gates/engineWiring.js";

test("parseWiringLedger reports an entry whose reasoning sentence is missing or empty", () => {
  const md = [
    "# ENGINE-WIRING.md",
    "",
    "- `src/engine/silent.ts` — **retire**:",
    "",
  ].join("\n");

  const result = parseWiringLedger(md);
  const entries = Array.isArray(result) ? result : result.entries;
  const problems = Array.isArray(result) ? [] : result.errors || result.problems || [];

  const silentEntry = entries.find((e) => e.path === "src/engine/silent.ts");

  const reasonIsBlank =
    !silentEntry ||
    !silentEntry.reason ||
    String(silentEntry.reason).trim() === "";

  const flaggedInEntry =
    silentEntry && (silentEntry.error || silentEntry.problem || silentEntry.invalid);
  const flaggedSeparately = problems.some((p) =>
    String(p.path || p.reason || p).includes("src/engine/silent.ts"),
  );

  assert.ok(reasonIsBlank, "sanity: the fixture's reasoning sentence is indeed empty");
  assert.ok(
    flaggedInEntry || flaggedSeparately,
    "an entry with a missing or empty reasoning sentence must be reported, not accepted as complete",
  );
});
