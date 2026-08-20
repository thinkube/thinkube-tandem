// WHY (INVARIANT): parseWiringLedger must turn each listed module into an
// entry carrying its verdict, and must refuse (name a reason, never throw)
// when a verdict is outside the closed set {wire, retire, fold} — a typo'd
// or invented verdict word must be caught by the parser, not silently
// accepted or crash the process reading the ledger.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseWiringLedger } from "../out-test/gates/engineWiring.js";

test("parseWiringLedger returns one entry per listed module carrying its verdict", () => {
  const md = [
    "# Engine wiring",
    "",
    "- `src/engine/verificationRunnable.ts` — wire: arms when the run-plan gate",
    "  reads it to check a slice's declared test command is runnable.",
    "- `src/engine/retiredSymbolFootprint.ts` — retire: arms the day grounding",
    "  grows a retires declaration, as DECISIONS.md already records.",
    "",
  ].join("\n");
  const result = parseWiringLedger(md);
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result));
  const entries = result.entries;
  assert.equal(entries.length, 2);
  const byModule = new Map(entries.map((e) => [e.module, e]));
  assert.equal(byModule.get("src/engine/verificationRunnable.ts").verdict, "wire");
  assert.equal(byModule.get("src/engine/retiredSymbolFootprint.ts").verdict, "retire");
});

test("parseWiringLedger refuses a verdict outside wire, retire and fold with a named reason rather than throwing", () => {
  const md = [
    "# Engine wiring",
    "",
    "- `src/engine/mystery.ts` — maybe-later: nobody has decided what this does yet.",
    "",
  ].join("\n");
  let result;
  assert.doesNotThrow(() => {
    result = parseWiringLedger(md);
  });
  assert.equal(result.ok, false);
  assert.ok(
    typeof result.reason === "string" && result.reason.length > 0,
    "the refusal names a reason",
  );
  assert.ok(
    /mystery\.ts/.test(result.reason) || /maybe-later/.test(result.reason),
    "the reason names the offending entry or verdict",
  );
});
