/**
 * parseWiringLedger reports an entry whose reasoning sentence is missing or
 * empty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWiringLedger } from "./engineWiring";

test("a missing or blank reasoning sentence is flagged", () => {
  const result = parseWiringLedger("- `src/engine/quux.ts` — **fold**: ");
  const entries = Array.isArray(result) ? result : result.entries;
  const problems = Array.isArray(result)
    ? []
    : ((result as any).errors ?? (result as any).problems ?? []);

  const quux = entries.find((e) => e.path === "src/engine/quux.ts");
  const flagged =
    (quux !== undefined &&
      ((quux as any).error || (quux as any).problem || (quux as any).invalid)) ||
    problems.some((p: any) =>
      (typeof p === "string" ? p : `${p.path ?? ""} ${p.reason ?? ""}`).includes("src/engine/quux.ts"),
    );

  assert.ok(flagged, "a blank reasoning sentence must be flagged, never accepted as complete");
});

test("a fully valid entry parses to a clean verdict and reason with no problems", () => {
  const result = parseWiringLedger(
    "- `src/engine/clean.ts` — **wire**: arms the day the dispatcher calls it directly.",
  );
  const entries = Array.isArray(result) ? result : result.entries;
  const problems = Array.isArray(result)
    ? []
    : ((result as any).errors ?? (result as any).problems ?? []);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].verdict, "wire");
  assert.ok(entries[0].reason.trim().length > 0);
  assert.equal(problems.length, 0);
});
