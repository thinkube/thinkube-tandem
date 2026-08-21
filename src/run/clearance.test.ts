/**
 * The door (docs/WORDS.md): a unit that needs a change it was not cleared
 * for gets the key and does the work itself.
 *
 * The rules pinned here are the ones a run broke: a promise was moved to
 * another slice because a path appeared in that slice's list, and nobody
 * kept it. Responsibility never moves. The only reason to wait is that
 * someone is changing the file at this moment, and waiting cannot deadlock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClearance, clearanceNote, doorView } from "./clearance";

const unit = (id: string, footprint: string[]) => ({ id, footprint });

function door(over: Partial<Parameters<typeof makeClearance>[0]> = {}) {
  const logs: string[] = [];
  const rulings: { reason: string }[] = [];
  const defects: { impact: string; detail: string }[] = [];
  const committed: string[] = [];
  const args = {
    units: [unit("SL-7#eu-0", ["src/panel.ts"]), unit("SL-2#eu-0", ["src/session.ts"])],
    changingNow: () => new Map<string, readonly string[]>(),
    commitBeforeWaiting: async (id: string) => void committed.push(id),
    halted: () => false,
    sleep: async () => {},
    log: (l: string) => void logs.push(l),
    onRuling: (r: { reason: string }) => void rulings.push(r),
    defect: (e: { impact: string; detail: string }) => void defects.push(e),
    ...over,
  } as Parameters<typeof makeClearance>[0];
  return { clear: makeClearance(args), logs, rulings, defects, committed, args };
}

test("REGRESSION (v2.0.135): a path another unit is cleared for is granted, never turned into that unit's obligation", async () => {
  // SL-7 had to prove that a session carries its space's name. The only
  // file for it was in SL-2's list, so the run refused SL-7 and asked SL-2
  // — a slice responsible for something else — to keep SL-7's promise.
  const d = door();
  const r = await d.clear("SL-7", "SL-7#eu-0", ["src/session.ts"]);
  assert.deepEqual(r.granted, ["src/session.ts"]);
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.waited, [], "nobody was changing it, so nothing was waited for");
  assert.ok(
    d.args.units[0].footprint.includes("src/session.ts"),
    "the clearance is in the list the guard and git read",
  );
  assert.match(d.rulings[0].reason, /cleared to change src\/session\.ts/, "and it is on the delivery");
  assert.equal(d.committed.length, 0, "no wait, so no partial commit");
});

test("a check file is never cleared to a production worker — the checks are the test author's", async () => {
  const d = door();
  const r = await d.clear("SL-7", "SL-7#eu-0", ["src/session.test.ts"]);
  assert.deepEqual(r.granted, []);
  assert.match(r.refused[0].why, /test-shaped/);
});

test("a file being changed at this moment is waited for, and the waiter commits first so it holds nothing", async () => {
  let live: [string, readonly string[]][] = [["SL-2#eu-0", ["src/session.ts"]]];
  const d = door({
    changingNow: () => new Map(live),
    // The other unit finishes while the waiter sleeps.
    sleep: async () => {
      live = [];
    },
  });
  const r = await d.clear("SL-7", "SL-7#eu-0", ["src/session.ts"]);
  assert.deepEqual(r.waited, ["src/session.ts"], "it waited at the door");
  assert.deepEqual(r.granted, ["src/session.ts"], "and then it went in");
  assert.deepEqual(d.committed, ["SL-7#eu-0"], "its work was committed before it waited — it held nothing");
  assert.match(d.logs.join("\n"), /waiting at the door/);
  assert.match(d.logs.join("\n"), /is free — going in/);
});

test("a wait that would close a cycle is never taken: the door opens and the machinery's defect is recorded", async () => {
  // Two units, each changing what the other asks for. Under the old rule
  // this is the shape that slept for hours; here neither one can wait.
  const live = new Map<string, readonly string[]>([
    ["A#eu-0", ["src/a.ts"]],
    ["B#eu-0", ["src/b.ts"]],
  ]);
  const d = door({
    units: [unit("A#eu-0", ["src/a.ts"]), unit("B#eu-0", ["src/b.ts"])],
    changingNow: () => live,
    // Nobody ever finishes: if a wait were taken, this test would hang.
    sleep: async () => {},
    halted: (() => {
      let n = 0;
      return () => ++n > 3;
    })(),
  });
  const a = d.clear("A#eu-0", "A#eu-0", ["src/b.ts"]);
  const b = d.clear("B#eu-0", "B#eu-0", ["src/a.ts"]);
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(ra.granted, ["src/b.ts"]);
  assert.deepEqual(rb.granted, ["src/a.ts"]);
  assert.ok(
    d.defects.some((x) => /cycle/.test(x.impact)),
    "the cycle is on the record as a defect of the machinery, not of the work",
  );
});

test("halt releases a unit waiting at a door", async () => {
  const d = door({
    changingNow: () => new Map([["SL-2#eu-0", ["src/session.ts"]]]),
    halted: () => true,
    sleep: async () => assert.fail("a halted run never sleeps at a door"),
  });
  const r = await d.clear("SL-7", "SL-7#eu-0", ["src/session.ts"]);
  assert.deepEqual(r.granted, ["src/session.ts"]);
});

test("the door's view: a unit that is waiting is changing nothing", () => {
  const live = new Map([
    ["A#eu-0", { tree: "/w", paths: ["src/a.ts"] }],
    ["B#eu-0", { tree: "/w", paths: ["src/b.ts"] }],
    ["T#eu-0", { tree: "/tester", paths: ["probes/p.test.mjs"] }],
  ]);
  const waiting = new Set(["B#eu-0"]);
  const v = doorView({ live: () => live, waiting: () => waiting, tree: "/w", commitUnitWork: async () => {} });
  assert.deepEqual([...v.changingNow().keys()], ["A#eu-0"], "not the waiter, not another tree");
});

test("what the worker is told: a grant says go now, never later", () => {
  const note = clearanceNote({ granted: ["src/session.ts"], refused: [], waited: [] });
  assert.match(note!, /you may now change src\/session\.ts/);
  assert.match(note!, /NOW, in this session/);
  assert.match(note!, /not a note for later/);
  const held = clearanceNote({ granted: ["src/a.ts"], refused: [], waited: ["src/a.ts"] });
  assert.match(held!, /waited until src\/a\.ts was free/);
  const no = clearanceNote({ granted: [], refused: [{ path: "src/x.test.ts", why: "test-shaped" }], waited: [] });
  assert.match(no!, /refused/i);
});
