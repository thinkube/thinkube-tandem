/**
 * INVARIANT — a push that stages no implications must never show a stale or
 * fabricated row. implicationRows returns no rows when push.impacts is
 * empty, or absent altogether, so the surface can safely render nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { implicationRows } from "./implications";
import type { SpacePush } from "./surfaceContract";

function basePush(): Omit<SpacePush, "impacts"> {
  return {
    kind: "space",
    running: false,
    phase: "understood",
    allowed: [],
    signedTeps: 0,
    questions: [],
    decisions: [],
    orphans: [],
    sentences: [],
    cost: { subjects: 0, rounds: 0 },
    outOfDate: { promises: 0, subjects: 0, rounds: 0 },
    ready: { subjects: 0, promises: 0, asks: 0, thinking: false },
    draft: "",
    subjects: [],
    cutCount: 0,
    deliveries: [],
    documentation: { state: "missing", landings: [] },
  };
}

test("implicationRows returns no rows when the push stages an empty impacts list", () => {
  const push = { ...basePush(), impacts: [] } as SpacePush;

  assert.deepEqual(implicationRows(push), [], "an empty impacts list yields no rows");
});
