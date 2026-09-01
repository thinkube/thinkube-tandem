/**
 * Keeping a reading finishes it — asks and what they are about, together.
 *
 * Keeping used to record only the asks. The reading stayed pending for ever
 * after that: the space sat on the reading screen, the subjects that sets are
 * grouped from never existed, and the button offered to "Keep 0 asks". Nine
 * asks went in and no way to split them ever appeared.
 *
 * Applying the reading costs nothing — no repository is read and no promise
 * is derived. That is paid when a set is chosen, and only for that set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { emptySpace } from "../core/schema";
import { keepDraftFlow } from "./draftFlow";
import { phaseOf } from "./phase";

function sessionReading(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keep-"));
  const s = new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  } as never);
  s.space = {
    ...emptySpace(),
    draft: "the tab row should stay put\ncards should say what they keep",
    proposal: {
      askIds: [],
      texts: ["the tab row should stay put", "cards should say what they keep"],
      subjects: [
        { name: "the tab row", from: [1], claims: [{ text: "stays in one place", from: 1 }] },
        { name: "every card", from: [2], claims: [{ text: "names its promise", from: 2 }] },
      ],
      missing: [],
    },
  } as never;
  return s;
}

test("keeping records the asks and what they are about, in one gesture", () => {
  const s = sessionReading();
  assert.equal(phaseOf(s), "read");

  assert.deepEqual(keepDraftFlow(s), { ok: true });

  assert.equal(s.space.asks.length, 2, "the words, recorded");
  assert.equal(s.space.subjects?.length, 2, "and what the reading found them to be about");
  assert.equal(s.space.proposal, undefined, "the reading is finished, not left pending");
  assert.equal(phaseOf(s), "understood", "so the sets can be grouped, before anything is worked out");
  assert.equal(s.space.nodes.length, 0, "and nothing has been worked out — that is paid per set");
});

test("a reading whose sentences are all recorded can still be finished", () => {
  // The state nine asks got stuck in: recorded, but the reading never kept,
  // so the screen offered to keep nothing and the phase never moved.
  const s = sessionReading();
  keepDraftFlow(s);
  const recorded = s.space.asks.length;
  s.space = {
    ...s.space,
    subjects: [],
    draft: "",
    proposal: {
      askIds: s.space.asks.map((a) => a.id),
      texts: s.space.asks.map((a) => a.text),
      subjects: [{ name: "the tab row", from: [1], claims: [] }],
      missing: [],
    },
  } as never;

  assert.deepEqual(keepDraftFlow(s), { ok: true }, "an empty page is not a reason to refuse a spent reading");
  assert.equal(s.space.asks.length, recorded, "and nothing is recorded twice");
  assert.equal(s.space.proposal, undefined);
  assert.equal(phaseOf(s), "understood");
});

test("an empty page with nothing read is still refused", () => {
  const s = sessionReading();
  s.space = { ...s.space, draft: "", proposal: undefined } as never;
  assert.equal(keepDraftFlow(s).ok, false);
});
