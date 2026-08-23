/**
 * An observation is not a check — at every layer one could enter as a
 * check: classified at birth by the grounding parser, skipped by the
 * reviewer panel, and carried on the delivery's face for the person. Never
 * a reason to withhold the very delivery the observation needs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { observationShaped } from "./observations";
import { gradeAssessments } from "./assess";
import { parseGroundedNodes } from "../derive/ground";
import { emptySpace } from "../core/schema";
import { rehouseChecks } from "./checkHomes";
import { extractDecisions } from "./testHomes";
import { refusedBeforeDispatch } from "./refusals";

/**
 * An observation is not a check, at every layer it could enter as one:
 * classified at birth, skipped by the reviewer panel, and carried on the
 * delivery's face for the person — never a reason to withhold the very
 * delivery the observation needs.
 */
test("a criterion only the running product can show is an observation, by rule", () => {
  assert.ok(observationShaped("in the running extension, opening two thinking spaces shows two tabs"));
  assert.ok(observationShaped("the user sees both panels side by side"));
  assert.equal(observationShaped("opening a key that already has a live tab reveals that tab"), undefined);
  assert.equal(observationShaped("greet() returns 'hello'"), undefined, "an honest check is untouched");
});

test("no reviewer is asked to judge an observation, and it rides the delivery by name", async () => {
  const asked: string[] = [];
  const graded = await gradeAssessments({
    space: {
      ...emptySpace(),
      asks: [{ id: "a1", text: "one tab per space", author: "t", at: "" }],
      nodes: [
        {
          id: "n1",
          sentence: "one tab per space",
          serves: ["a1"],
          needs: [],
          acceptance: [
            { id: "c1", text: "in the running extension, two spaces show two tabs", kind: "assessment" },
            { id: "c2", text: "the register holds one entry per key", kind: "assessment" },
          ],
        },
      ],
    } as never,
    cut: { id: "cut-1", changeIds: ["n1"] },
    testerWt: "/nowhere",
    model: "sonnet",
    round: async (_d, prompt) => {
      asked.push(prompt);
      return "GREEN it does";
    },
  });
  assert.equal(asked.length, 1, "the reviewer was asked about the real check only");
  assert.match(asked[0], /register holds one entry/);
  assert.equal(graded.observations.length, 1);
  assert.match(graded.observations[0], /running extension/);
  assert.equal(graded.proofs.length, 1);
  assert.equal(graded.proofs[0].verdict, "green");
});

test("grounding moves an observation-worded criterion to the unverified notes at birth", () => {
  const parsed = parseGroundedNodes(
    JSON.stringify({
      nodes: [
        {
          sentence: "one tab per space",
          touchpoints: [{ path: "src/x.ts" }],
          acceptance: [
            { text: "in the running extension, two spaces show two tabs" },
            { text: "the register holds one entry per key" },
          ],
        },
      ],
    }),
    "/nowhere",
    () => true,
  );
  const n = parsed?.[0];
  assert.ok(n);
  assert.deepEqual(
    n!.acceptance.map((c) => c.text),
    ["the register holds one entry per key"],
    "the check stays a check",
  );
  assert.equal(n!.unverified?.length, 1);
  assert.match(n!.unverified![0].text, /running extension/);
});

test("a check is born beside code, never beside a document", () => {
  const slices = [
    {
      handle: "SL-5",
      workUnits: [
        { role: "code", footprint: ["ENGINE-WIRING.md", "src/gates/engineWiring.ts"] },
        { role: "test", footprint: ["probes/x__SL-5_AC-1.test.mjs"] },
      ],
    },
  ];
  const moved = rehouseChecks(slices as never, ["src/a.ts", "src/a.test.ts"]);
  assert.deepEqual(moved.map((m) => m.to), ["src/gates/engineWiring_AC-1.test.ts"]);
});

test("a slice that lands only in documents keeps its check where it was", () => {
  const slices = [{ handle: "SL-9", workUnits: [{ role: "code", footprint: ["docs/x.md"] }, { role: "test", footprint: ["probes/x__SL-9_AC-1.test.mjs"] }] }];
  assert.deepEqual(rehouseChecks(slices as never, ["src/a.ts", "src/a.test.ts"]), []);
});

test("a later decision about the same symbol replaces the earlier one", () => {
  const decided = extractDecisions(
    [
      "DECISION: `pushActive`'s shape is `{ tabs, sessionKey, activeKey, message }`",
      "DECISION: `heartbeat` returns a string",
      "DECISION: `pushActive`'s new signature is `pushActive({ tabs, sessions, activeKey, key, title, message })`",
    ].join("\n"),
  );
  assert.equal(decided.length, 2);
  assert.ok(decided.some((d) => /pushActive\(\{ tabs, sessions/.test(d)), "the later shape stands");
  assert.ok(!decided.some((d) => /sessionKey, activeKey, message \}`$/.test(d)), "the earlier is gone");
});

test("a promise that introduces a function without its shape is refused before dispatch", async () => {
  const refusals = await refusedBeforeDispatchIn({
    slices: [{ handle: "SL-8", status: "ready", files: ["src/extension.ts"], workUnits: [{ footprint: ["src/extension.ts"], execution: "serial", role: "code" }], criterionIds: ["c1"] }],
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "a delivery message opens its own space's tab",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "the message reaches that space's tab only" }],
          grounding: { touchpoints: [{ path: "src/extension.ts", symbol: "pushActive", planned: true }], stamp: [] },
        },
      ],
    },
  });
  assert.equal(refusals.length, 1, JSON.stringify(refusals));
  assert.match(refusals[0], /without saying its shape/);
  const shaped = await refusedBeforeDispatchIn({
    slices: [{ handle: "SL-8", status: "ready", files: ["src/extension.ts"], workUnits: [{ footprint: ["src/extension.ts"], execution: "serial", role: "code" }], criterionIds: ["c1"] }],
    space: {
      ...emptySpace(),
      nodes: [{ id: "n1", sentence: "x", serves: [], needs: [], acceptance: [{ id: "c1", text: "y" }], grounding: { touchpoints: [{ path: "src/extension.ts", symbol: "pushActive(key: string, message: string): void", planned: true }], stamp: [] } }],
    },
  });
  assert.deepEqual(shaped, []);
});

/** The pre-flight as the run calls it, with the repository stood in for. */
async function refusedBeforeDispatchIn(a: { slices: unknown[]; space: unknown }): Promise<string[]> {
  const r = await refusedBeforeDispatch({
    slices: a.slices as never,
    space: a.space as never,
    cut: { id: "cut-1", changeIds: ["n1"] },
    repoRoot: "/nowhere",
    exec: async () => ({ code: 0, out: "" }),
    log: () => {},
  });
  return r.refusal ? r.refusal.refusal.split("\n") : [];
}
