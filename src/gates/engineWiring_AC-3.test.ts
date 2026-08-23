/**
 * parseWiringLedger returns one entry per listed module carrying its verdict,
 * and refuses a verdict outside wire, retire and fold with a named reason
 * rather than throwing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWiringLedger } from "./engineWiring";

test("one entry per listed module, and an unknown verdict is a named problem, not a throw", () => {
  const md = [
    "- `src/engine/foo.ts` — **wire**: arms the day the run command dispatches it.",
    "- `src/engine/bar.ts` — **retire**: no consumer remains after the v1 pipeline removal.",
    "- `src/engine/baz.ts` — **maybe**: unclear yet.",
  ].join("\n");

  assert.doesNotThrow(() => parseWiringLedger(md), "an unknown verdict must never throw");

  const result = parseWiringLedger(md);
  const entries = Array.isArray(result) ? result : result.entries;

  assert.equal(entries.length, 2, "only the two valid verdicts become entries");
  assert.equal(entries.find((e) => e.path === "src/engine/foo.ts")?.verdict, "wire");
  assert.equal(entries.find((e) => e.path === "src/engine/bar.ts")?.verdict, "retire");

  const problems = Array.isArray(result)
    ? []
    : ((result as any).errors ?? (result as any).problems ?? []);
  const bazEntry = entries.find((e) => e.path === "src/engine/baz.ts");
  const bazFlagged =
    (bazEntry !== undefined &&
      ((bazEntry as any).error || (bazEntry as any).problem || (bazEntry as any).invalid)) ||
    problems.some((p: any) =>
      (typeof p === "string" ? p : `${p.path ?? ""} ${p.reason ?? ""}`).includes("src/engine/baz.ts"),
    );
  assert.ok(
    bazFlagged,
    "an unrecognized verdict must be reported as a named problem, not silently accepted",
  );
});
