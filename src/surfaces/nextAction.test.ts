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

test("chosen and not worked out: see what it will do, at a stated cost", () => {
  const push = quiet({ specs: [set("s1", { chosen: true })], cost: { subjects: 2, rounds: 4 } });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "See what it will do");
  assert.match(n.hint, /2 subjects .* 4 rounds/);
  assert.deepEqual(n.move, { kind: "post", action: { action: "think" } });
});

test("chosen and worked out: build these, on the page that states the price", () => {
  const push = quiet({
    specs: [set("s1", { chosen: true, promises: 5 })],
    ready: { subjects: 2, promises: 5, asks: 3, thinking: false },
  });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Build these 5");
  assert.deepEqual(n.move, { kind: "tab", tab: "work" });
});

test("building: the only press is stop", () => {
  const push = quiet({ running: true, specs: [set("s1", { chosen: true })] });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Stop");
  assert.match(n.where, /building — set s1/);
});

test("delivered and not accepted: read what came back", () => {
  const push = quiet({ deliveries: [{ id: "d1", page: "", accepted: false }] });
  const n = nextAction(push, { behind: false, allowed: () => true });
  assert.equal(n.label, "Read what came back");
  assert.deepEqual(n.move, { kind: "tab", tab: "flow" });
});
