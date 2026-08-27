/**
 * INVARIANT: parseWiringLedger refuses a row whose verdict word is not
 * one of wire, retire or fold — it must never return that row with an
 * invented or unknown verdict, because a silently-accepted typo would let
 * a bad ledger row pass as judged when nobody actually decided. Must hold
 * forever: the parser is the one place the three-word vocabulary is
 * enforced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWiringLedger } from "./engineWiring";

test("parseWiringLedger refuses a row whose verdict word is not wire, retire or fold", () => {
  const markdown = `# Engine wiring

| Module | Verdict | Reason |
| --- | --- | --- |
| src/engine/core/watchdog.ts | maybe | src/run/watchdog.ts already does this job in v2. |
`;
  assert.throws(
    () => parseWiringLedger(markdown),
    "an unrecognized verdict word must not silently pass through",
  );
});
