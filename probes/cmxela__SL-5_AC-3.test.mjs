// WHY (INVARIANT): the ledger reader must turn every listed module into one
// entry carrying its verdict, and must refuse a verdict outside wire/retire/
// fold with a named reason rather than throwing — a caller that walks the
// ledger can never be crashed by a malformed entry. This must hold for as
// long as the ledger format exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWiringLedger } from "../out-test/gates/engineWiring.js";

test("parseWiringLedger returns one entry per listed module carrying its verdict", () => {
  const md = [
    "# ENGINE-WIRING.md",
    "",
    "- `src/engine/retiredSymbolFootprint.ts` — **wire**: arms the day grounding grows a retires declaration.",
    "- `src/engine/someOldThing.ts` — **retire**: no consumer exists and none is planned.",
    "",
  ].join("\n");

  const result = parseWiringLedger(md);
  const entries = Array.isArray(result) ? result : result.entries;

  assert.equal(entries.length, 2, "one entry per listed module");

  const bySymbol = entries.find((e) => e.path === "src/engine/retiredSymbolFootprint.ts");
  assert.ok(bySymbol, "the wire-verdict module must produce an entry");
  assert.equal(bySymbol.verdict, "wire");

  const retired = entries.find((e) => e.path === "src/engine/someOldThing.ts");
  assert.ok(retired, "the retire-verdict module must produce an entry");
  assert.equal(retired.verdict, "retire");
});

test("parseWiringLedger refuses a verdict outside wire, retire and fold with a named reason rather than throwing", () => {
  const md = [
    "# ENGINE-WIRING.md",
    "",
    "- `src/engine/weird.ts` — **maybe-later**: not sure yet what this does.",
    "",
  ].join("\n");

  assert.doesNotThrow(() => {
    const result = parseWiringLedger(md);
    const entries = Array.isArray(result) ? result : result.entries;
    const problems = Array.isArray(result) ? [] : result.errors || result.problems || [];

    const weirdEntry = entries.find((e) => e.path === "src/engine/weird.ts");
    const flaggedInEntry =
      weirdEntry && (weirdEntry.error || weirdEntry.problem || weirdEntry.invalid);
    const flaggedSeparately = problems.some((p) =>
      String(p.path || p.reason || p).includes("src/engine/weird.ts"),
    );

    assert.ok(
      flaggedInEntry || flaggedSeparately,
      "a verdict outside wire/retire/fold must be reported with a named reason, not silently accepted",
    );
  }, "parseWiringLedger must never throw on an invalid verdict");
});
