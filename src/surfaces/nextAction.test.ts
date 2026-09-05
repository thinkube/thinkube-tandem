/**
 * The one next action says what will happen, from the push alone.
 *
 * One state at a time, in the order the work moves: nothing written, lines
 * written, a reading to keep, sentences read into things, a thing chosen,
 * building, delivered. Each state names one press, and the press is the
 * thing that moves the work on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { nextAction } from "./nextAction";
import type { SpacePush } from "./surfaceContract";

const FIXTURE = path.resolve(__dirname, "..", "..", "src", "surfaces", "surfaceFits.push.json");
const BASE = JSON.parse(
  fs.readFileSync(fs.existsSync(FIXTURE) ? FIXTURE : path.join(__dirname, "surfaceFits.push.json"), "utf8"),
) as SpacePush;

/** A quiet space: nothing running, nothing delivered, nothing chosen. */
function quiet(over: Partial<SpacePush>): SpacePush {
  return {
    ...BASE,
    running: false,
    activity: undefined,
    grounding: [],
    pendingModel: undefined,
    deliveries: [],
    signedIdle: undefined,
    draft: "",
    cost: { subjects: 0, rounds: 0 },
    ready: { subjects: 0, promises: 0, asks: 0, thinking: false },
    specs: [],
    ...over,
  };
}
const allowed = (push: SpacePush) => (x: string) => push.allowed.includes(x);
const set = (id: string, over: Partial<NonNullable<SpacePush["specs"]>[number]> = {}) => ({
  id,
  name: `set ${id}`,
  subjects: 2,
  asks: [1, 2, 3],
  promises: 0,
  chosen: false,
  built: false,
  repos: ["r"],
  ...over,
});

test("nothing written: the press waits for a line", () => {
  const n = nextAction(quiet({ sentences: [], subjects: [] }), { behind: false, allowed: () => true });
  assert.equal(n.enabled, false);
  assert.equal(n.where, "nothing written yet");
});

test("lines written and not read: read them", () => {
  const n = nextAction(quiet({ sentences: [], subjects: [], draft: "one\ntwo" }), { behind: false, allowed: () => true });
  assert.equal(n.label, "Read these 2");
  assert.deepEqual(n.move, { kind: "post", action: { action: "read-draft" } });
});

test("a reading not yet kept: keep it, unless the words moved", () => {
  const pending = { subjects: [], texts: ["a", "b"], fresh: ["a", "b"], missing: [] } as never;
  const keep = nextAction(quiet({ pendingModel: pending }), { behind: false, allowed: () => true });
  assert.equal(keep.label, "Keep these 2");
  const again = nextAction(quiet({ pendingModel: pending }), { behind: true, allowed: () => true });
  assert.equal(again.label, "Read it again");
});

test("read but not grouped: group", () => {
  const push = quiet({ specs: [] });
  const n = nextAction(push, { behind: false, allowed: allowed(push) });
  assert.equal(n.label, "Group into things to build");
});

test("grouped and nothing chosen: build the first, and say how much of yours it carries", () => {
  const push = quiet({ specs: [set("s1", { asks: [1, 2, 3, 4, 5] }), set("s2", { asks: [6] })] });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Build the first");
  assert.match(n.hint, /5 of your sentences/);
  assert.deepEqual(n.move, { kind: "post", action: { action: "choose-set", specId: "s1" } });
  assert.match(n.where, /2 things to build/);
});

test("a set whose work landed is never the first to build", () => {
  const push = quiet({ specs: [set("done", { built: true, fate: "accepted", promises: 9 }), set("next")] });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.deepEqual(n.move, { kind: "post", action: { action: "choose-set", specId: "next" } });
});

test("a set signed whose run delivered nothing is not offered as the next thing to build", () => {
  // Its one press is Run it again, on the strip; offering it here as the
  // next thing to build would sign it a second time.
  const push = quiet({ specs: [set("refused", { built: true, fate: "not run", promises: 9 }), set("next")] });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.deepEqual(n.move, { kind: "post", action: { action: "choose-set", specId: "next" } });
});

test("chosen and not worked out: work it out, at its own stated cost", () => {
  const push = quiet({ specs: [set("s1", { chosen: true })], cost: { subjects: 2, rounds: 6 } });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Work it out");
  assert.match(n.hint, /2 subjects .* 6 rounds/);
  assert.deepEqual(n.move, { kind: "post", action: { action: "choose-set", specId: "s1" } });
});

test("chosen and worked out: build these — and it signs", () => {
  const push = quiet({
    specs: [set("s1", { chosen: true, promises: 5 })],
    ready: { subjects: 2, promises: 5, asks: 3, thinking: false },
    documentation: { state: "exempt", landings: [], reason: "nothing to document" },
  });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Build these 5");
  assert.equal(n.enabled, true);
  assert.match(n.hint, /signs 3 sentences read-only/);
  assert.deepEqual(n.move, { kind: "post", action: { action: "build", specId: "s1" } });
});

test("build waits for the documentation line, and says so", () => {
  const push = quiet({
    specs: [set("s1", { chosen: true, promises: 5 })],
    ready: { subjects: 2, promises: 5, asks: 3, thinking: false },
    documentation: { state: "missing", landings: [] },
  });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Build these 5");
  assert.equal(n.enabled, false);
  assert.match(n.hint, /documentation/);
});

test("building: the only press is stop", () => {
  const push = quiet({ running: true, specs: [set("s1", { chosen: true })] });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Stop");
  assert.match(n.where, /building — set s1/);
});

test("delivered and not accepted: the one press is the decision", () => {
  const push = quiet({ deliveries: [{ id: "d1", page: "", accepted: false }] });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Accept it");
  assert.deepEqual(n.move, { kind: "post", action: { action: "accept-delivery", deliveryId: "d1" } });
});

test("withheld: the one press is the way back in, and the reason is beside it", () => {
  const push = quiet({ deliveries: [{ id: "d1", page: "", accepted: false, withheld: "2 promises are not kept", rerun: { id: "cut-1" } }] });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Run it again");
  assert.match(n.hint, /not kept/);
  assert.deepEqual(n.move, { kind: "post", action: { action: "rerun" } });
});

test("while subjects are being worked out, the strip says how far, and is busy", () => {
  const push = quiet({
    grounding: [{ askId: "s-1", label: "reading the code", current: 2, total: 5 }],
    cost: { subjects: 1, rounds: 2 },
    subjects: [
      { id: "s-1", name: "my tasks", claims: [], from: [], thinking: { label: "reading the code", current: 2, total: 5 } },
      { id: "s-2", name: "the box", claims: [], from: [] },
    ],
  });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.busy, true);
  assert.equal(n.enabled, false);
  assert.match(n.where, /1 of 2 subjects worked out — reading the code/);
});

test("a re-reading of sentences already kept is kept as a reading, not as zero sentences", () => {
  const pending = { subjects: [{ name: "my tasks" }], texts: ["a", "b"], fresh: [], missing: [] } as never;
  const keep = nextAction(quiet({ pendingModel: pending }), { behind: false, allowed: () => true });
  assert.equal(keep.label, "Keep this reading");
  assert.deepEqual(keep.move, { kind: "post", action: { action: "keep-draft" } });
});

test("signed work that never ran: the one press is Run it again, before any other thing to build", () => {
  const push = quiet({
    unrun: { id: "cut-1", tepId: "TEP-1" },
    signedIdle: { heading: "Nothing is running.", sentence: "The build stopped: the product build fails on the untouched tree", canRerun: true, canThinkAgain: true },
    specs: [{ id: "s1", name: "first", subjectIds: ["a"], built: true, promises: 3 }, { id: "s2", name: "second", subjectIds: ["b"], promises: 0 }],
  } as never);
  const n = nextAction(push, { behind: false, allowed: (x) => x === "rerun" });
  assert.equal(n.label, "Run it again");
  assert.equal(n.enabled, true);
  assert.match(n.hint, /product build fails/);
  assert.deepEqual(n.move, { kind: "post", action: { action: "rerun" } });
});

/**
 * Work that is in the project and will not build is not offered as
 * something to keep: a press to keep a failed build reads as keeping the
 * failure, and the act that leaves the project working is the other one.
 */
test("when the platform refuses the merged work, the one press is to take it back out", () => {
  const push = quiet({
    deliveries: [
      {
        id: "d1",
        page: "",
        accepted: false,
        merged: true,
        afterMerge: { outcome: "broke" as const, said: "the platform", detail: "build-frontend did not pass", tried: 2 },
      },
    ],
  });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Take it back out");
  assert.match(n.where, /the platform will not build it/);
  assert.match(n.hint ?? "", /build-frontend did not pass/, "in the platform's own words");
  assert.deepEqual(n.move, { kind: "post", action: { action: "reject-delivery", deliveryId: "d1" } });
});

/**
 * The strip's promise is that there is always one thing to press. A
 * greyed press with nothing behind it breaks the walk: a set that had
 * been built and accepted stayed "in hand", so the strip offered "Build
 * these 0", disabled, while the next thing to build sat underneath it.
 */
test("a set that has landed is no longer in hand: the press moves to the next thing", () => {
  const push = quiet({
    specs: [
      set("s1", { chosen: true, built: true, fate: "accepted", promises: 6 }),
      set("s2", { promises: 0 }),
      set("s3", { promises: 0 }),
    ],
    deliveries: [{ id: "d1", page: "", accepted: true }],
    ready: { subjects: 0, promises: 0, asks: 0, thinking: false },
  });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Build the first");
  assert.equal(n.enabled, true, "and it can be pressed");
  assert.deepEqual(n.move, { kind: "post", action: { action: "choose-set", specId: "s2" } });
});

test("no state offers a press that cannot be pressed while something is still to build", () => {
  // Every shape a space passes through on the walk, with everything
  // allowed: the one press must either do something or say plainly that
  // there is nothing left.
  const shapes: { name: string; push: SpacePush }[] = [
    { name: "nothing written", push: quiet({}) },
    { name: "a draft", push: quiet({ draft: "one\ntwo" }) },
    { name: "sets proposed", push: quiet({ specs: [set("s1"), set("s2")] }) },
    {
      name: "one in hand, worked out",
      push: quiet({
        specs: [set("s1", { chosen: true, promises: 3 })],
        ready: { subjects: 0, promises: 3, asks: 3, thinking: false },
        // The documentation decision is its own gate, with its own line on
        // the page; made, so what is left is the build itself.
        documentation: { state: "landed", landings: [] },
      }),
    },
    {
      name: "one accepted, another to build",
      push: quiet({
        specs: [set("s1", { chosen: true, fate: "accepted", built: true }), set("s2")],
        deliveries: [{ id: "d1", page: "", accepted: true }],
      }),
    },
    {
      name: "everything accepted",
      push: quiet({
        specs: [set("s1", { chosen: true, fate: "accepted", built: true })],
        deliveries: [{ id: "d1", page: "", accepted: true }],
      }),
    },
  ];
  for (const { name, push } of shapes) {
    const n = nextAction(push, { behind: false, allowed: () => true });
    if (n.label === "Everything is built") continue; // the one honest dead end
    assert.equal(n.enabled, true, `"${name}" offers "${n.label}", which cannot be pressed`);
    assert.notEqual(n.move.kind, "none", `"${name}" offers "${n.label}", which does nothing`);
  }
});
