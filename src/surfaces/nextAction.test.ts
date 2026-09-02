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

test("a built set is never the first to build", () => {
  const push = quiet({ specs: [set("done", { built: true, promises: 9 }), set("next")] });
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
  assert.deepEqual(n.move, { kind: "post", action: { action: "build" } });
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
