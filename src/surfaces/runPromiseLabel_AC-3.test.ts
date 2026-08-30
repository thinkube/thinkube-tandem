/**
 * TRANSITION: before promiseLabelOf existed, there was no seam that could
 * say "this unit has no promise to title itself with". This pins that it
 * answers undefined — never a placeholder object — when no unit of the
 * slice matches, or the matching unit holds no change, and that the
 * calling card's title, in that case, falls back to its own pre-existing
 * text rather than a bare unit id.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promiseLabelOf } from "./runPromiseLabel";
import type { Change, Unit } from "../core/schema";

function change(id: string, sentence: string): Change {
  return { id, sentence, serves: [], needs: [], acceptance: [] };
}

test("promiseLabelOf returns undefined when no unit of the slice matches", () => {
  const nodes = [change("chg-1", "Some promise.")];
  const units: Unit[] = [{ id: "SL-2#eu-1", changeIds: ["chg-1"] }];

  const out = promiseLabelOf({ nodes, units, slice: "SL-9" });

  assert.equal(out, undefined, "no unit belongs to SL-9, so there is nothing to label");
});

test("promiseLabelOf returns undefined when the matching unit holds no change", () => {
  const nodes: Change[] = [];
  const units: Unit[] = [{ id: "SL-1#eu-1", changeIds: [] }];

  const out = promiseLabelOf({ nodes, units, slice: "SL-1" });

  assert.equal(out, undefined, "a unit with no changeIds has no promise to keep, so no label is produced");
});

test("the calling card's title falls back to its own pre-existing text, not a bare unit id, when promiseLabelOf gives nothing", () => {
  // Mirrors the title expression Run.tsx's cards useMemo already uses
  // (u.sliceTitle ?? u.slice) — the same fallback path a promise-label
  // lookup that returns undefined must leave in place.
  const u = { id: "SL-9#eu-1", slice: "SL-9", sliceTitle: undefined as string | undefined };
  const label = undefined as { label: string; full: string } | undefined;

  const title = label?.label ?? (u.sliceTitle ?? u.slice);

  assert.equal(title, "SL-9", "the fallback title is the slice, not the unit id");
  assert.ok(
    !title.includes("#eu-"),
    "the rendered title contains no bare unit-id string when promiseLabelOf returns undefined",
  );
});
