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
import { panicFlow } from "./captureFlows";
import { phaseOf } from "./phase";

function sessionReading(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keep-"));
  const s = new TandemSession({
    author: "tester",
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

/**
 * Panic clears everything derived, and only what you wrote stays.
 *
 * It used to leave the subjects and the claims behind. A reading is derived
 * exactly like a promise is, so leaving it meant a space could never be read
 * again: its first reading was its only one, however much better a later one
 * would be. Nine sentences read into nine subjects stayed nine subjects for
 * ever, and the improvement that turned them into three could not reach a
 * space that already existed.
 */
test("panic leaves your sentences and nothing else", () => {
  const s = sessionReading();
  keepDraftFlow(s);
  s.space = {
    ...s.space,
    nodes: [{ id: "n1", serves: [s.space.subjects![0].id], sentence: "x", needs: [], acceptance: [] }],
    specs: [{ id: "spec-1", name: "a set", subjectIds: [s.space.subjects![0].id] }],
    questions: [
      { id: "q1", askId: "a1", text: "undecided", recommendation: "r" },
      { id: "q2", askId: "a1", text: "already yours", recommendation: "r", decided: { text: "yes", at: "" } },
    ],
  } as never;

  const r = panicFlow(s.space);
  assert.ok(!("reason" in r), "nothing is signed, so there is nothing to refuse");
  const after = (r as { space: typeof s.space }).space;

  assert.equal(after.asks.length, 2, "your words are not derived and never go");
  assert.deepEqual(after.subjects, [], "the reading is derived, and goes with the rest");
  assert.deepEqual(after.claims, []);
  assert.deepEqual(after.nodes, []);
  assert.deepEqual(after.specs, []);
  assert.equal(after.proposal, undefined);
  assert.deepEqual(after.questions.map((q) => q.id), ["q2"], "a decision you gave is yours, and stays");
});

/**
 * Reading again REPLACES the reading it corrects.
 *
 * Saying one sentence differently re-reads every sentence, which is right —
 * a reading is about the whole list. But keeping that reading used to ADD it
 * to the one before: nine subjects became twelve, the promises of both
 * readings sat side by side, and a correction made the space grow instead of
 * change. There was no way to correct anything, only ways to add.
 */
test("a corrected reading replaces the one it corrects, and takes its work with it", () => {
  const s = sessionReading();
  keepDraftFlow(s);
  const first = s.space.subjects!.map((x) => x.id);
  assert.equal(first.length, 2);

  // Promises derived from that reading.
  s.space = {
    ...s.space,
    nodes: [
      { id: "n1", serves: [first[0]], sentence: "from the old reading", needs: [], acceptance: [] },
      { id: "n2", serves: [first[1]], sentence: "also old", needs: [], acceptance: [] },
    ],
  } as never;

  // The same two sentences, read again — one subject this time.
  s.space = {
    ...s.space,
    proposal: {
      askIds: s.space.asks.map((a) => a.id),
      texts: s.space.asks.map((a) => a.text),
      subjects: [
        {
          name: "the surface",
          from: [1, 2],
          claims: [
            { text: "the row stays put", from: 1, mention: "The tab row" },
            { text: "cards say what they keep", from: 2, mention: "cards" },
          ],
        },
      ],
      missing: [],
    },
  } as never;
  keepDraftFlow(s);

  assert.equal(s.space.subjects!.length, 1, "one reading of these sentences, not two");
  assert.equal(s.space.subjects![0].name, "the surface");
  assert.equal(s.space.claims!.length, 2, "and its claims, not four");
  assert.deepEqual(s.space.nodes, [], "what the old reading derived went with it");
  assert.equal(s.space.asks.length, 2, "your sentences are untouched throughout");
});
