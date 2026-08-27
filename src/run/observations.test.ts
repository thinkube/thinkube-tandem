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
import { parseGroundedNodes, runGrounding } from "../derive/ground";
import { emptySpace } from "../core/schema";
import { rehouseChecks } from "./checkHomes";

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

test("a seam named by a bare name is shaped at derivation, by the machine, before anything is sliced", async () => {
  // The contract carries signatures. A grounding that names a function by
  // its bare name gets one more round, for exactly those symbols; what comes
  // back is the seam the tester and the coder are both written to.
  const prompts: string[] = [];
  const r = await runGrounding(
    { model: "sonnet", repoRoot: process.cwd(), log: () => {} },
    { id: "a1", text: "a delivery message opens its own space's tab" } as never,
    { nextIndex: 1 },
    async (_d, prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1)
        return JSON.stringify({
          nodes: [
            {
              sentence: "a delivery message opens its own space's tab",
              touchpoints: [{ path: "src/extension.ts", symbol: "pushActive" }],
              acceptance: [{ text: "the message reaches that space's tab only" }],
            },
          ],
          questions: [],
        });
      assert.match(prompt, /src\/extension\.ts › pushActive/, "the seam round is asked about exactly the bare name");
      return "1: pushActive(key: string, message: string): void";
    },
  );
  assert.equal(prompts.length, 2, "one grounding round, one seam round");
  const sym = r.changes[0]?.grounding?.touchpoints[0]?.symbol;
  assert.equal(sym, "pushActive(key: string, message: string): void");
});
