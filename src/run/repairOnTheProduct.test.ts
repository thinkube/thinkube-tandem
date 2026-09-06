/**
 * What the reviewers find on the page is repaired by the run, not handed
 * to the person with the work live and wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { repairWhatDidNotHold, whatDidNotHold } from "./repairOnTheProduct";
import { RunState } from "./state";
import type { Change, Cut, Space } from "../core/schema";
import type { DispatchOutcome } from "./state";

const space = (): Space =>
  ({
    asks: [],
    nodes: [
      {
        id: "n1",
        sentence: "the new-task box takes the cursor",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "frontend/src/components/NewTask.tsx" }], stamp: [] },
        acceptance: [{ id: "c1", text: "the cursor is in the title" }, { id: "c2", text: "Enter saves" }],
      } as unknown as Change,
      {
        id: "n2",
        sentence: "the list is in due-date order",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "frontend/src/pages/Tasks.tsx" }], stamp: [] },
        acceptance: [{ id: "c3", text: "soonest first" }],
      } as unknown as Change,
    ],
    subjects: [],
    claims: [],
    cuts: [],
    deliveries: [],
  }) as unknown as Space;

const cut: Cut = { id: "cut-1", changeIds: ["n1", "n2"] } as unknown as Cut;

const outcomeWith = (verdicts: { id: string; verdict: "green" | "red"; label: string }[]): DispatchOutcome =>
  ({
    refusals: [],
    undelivered: [],
    delivery: {
      id: "d1",
      proofs: verdicts.map((v) => ({ kind: "assessment", label: v.label, verdict: v.verdict, criterionId: v.id })),
    },
  }) as unknown as DispatchOutcome;

test("what did not hold names the promises, their files, and the reviewer's words", () => {
  const found = whatDidNotHold({
    space: space(),
    cut,
    outcome: outcomeWith([
      { id: "c1", verdict: "red", label: "the cursor is in the title — it stays on the page behind" },
      { id: "c2", verdict: "green", label: "Enter saves" },
      { id: "c3", verdict: "green", label: "soonest first" },
    ]),
  })!;
  assert.deepEqual(found.promises, ["the new-task box takes the cursor"], "only the promise that failed");
  assert.deepEqual(found.files, ["frontend/src/components/NewTask.tsx"], "bounded to where it lands");
  assert.match(found.evidence, /it stays on the page behind/, "in the reviewer's own words");
});

test("nothing red, nothing to repair", () => {
  assert.equal(
    whatDidNotHold({ space: space(), cut, outcome: outcomeWith([{ id: "c1", verdict: "green", label: "ok" }]) }),
    undefined,
  );
});

/** A loop with everything answering yes, and a note of what it did. */
function loop(over: Partial<Parameters<typeof repairWhatDidNotHold>[0]> = {}) {
  const said: string[] = [];
  const box = { repairs: 0, pushes: 0, judged: [] as string[][] };
  const args = {
    st: new RunState(() => {}),
    say: (l: string) => said.push(l),
    doing: (l: string) => said.push(l),
    repair: async () => (box.repairs++, { green: true, report: "fixed" }),
    buildsHere: async () => ({ ok: true, output: "" }),
    land: async () => (box.pushes++, { ok: true }),
    waitUntilLive: async () => ({ live: true }),
    judgeAgain: async (promises: string[]) => {
      box.judged.push(promises);
      return outcomeWith([{ id: "c1", verdict: "green", label: "the cursor is in the title" }]);
    },
    outcome: outcomeWith([
      { id: "c1", verdict: "red", label: "the cursor is in the title — it does not" },
      { id: "c3", verdict: "green", label: "soonest first" },
    ]),
    space: space(),
    cut,
    ...over,
  };
  return { args, said, box };
}

test("a red on the page is repaired, pushed, taken live and judged again — only what was red", async () => {
  const l = loop();
  const out = await repairWhatDidNotHold(l.args);
  assert.equal(l.box.repairs, 1);
  assert.equal(l.box.pushes, 1);
  assert.deepEqual(l.box.judged, [["the new-task box takes the cursor"]], "the other promise is not driven again");
  assert.deepEqual(
    (out.delivery?.proofs ?? []).map((p) => p.verdict),
    ["green"],
    "and the delivery carries the answer it now has",
  );
});

test("two repairs, then it stops and says what still does not hold", async () => {
  const l = loop({ judgeAgain: async () => outcomeWith([{ id: "c1", verdict: "red", label: "still not" }]) });
  await repairWhatDidNotHold(l.args);
  assert.equal(l.box.repairs, 2, "it does not loop for ever");
  assert.ok(
    l.said.some((s) => /still do not hold on the running product after 2 repairs/.test(s)),
    l.said.join(" · "),
  );
});

test("a repair that does not build here is never pushed", async () => {
  const l = loop({ buildsHere: async () => ({ ok: false, output: "error TS2345" }) });
  await repairWhatDidNotHold(l.args);
  assert.equal(l.box.pushes, 0);
  assert.ok(l.said.some((s) => /does not build here/.test(s)));
});

test("a stopped run repairs nothing", async () => {
  const l = loop();
  l.args.st.halt();
  await repairWhatDidNotHold(l.args);
  assert.equal(l.box.repairs, 0);
});
