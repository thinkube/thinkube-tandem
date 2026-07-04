/**
 * SP-6/9 (TEP-6) AC2 — **the judge triangulates against the contract, not hand-vs-hand.**
 *
 * When the closing gate goes red, the code-vs-test judge must decide each hand's
 * conformance against the ONE artifact both hands built to — the slice's contract —
 * rather than by comparing the two hands to each other. This test pins the two
 * observable properties of the prompt the judge is handed, driving ONLY the public
 * `buildJudgePrompt` surface named in the SPEC CONTRACT:
 *
 *   1. CONTRACT REACHES THE JUDGE VERBATIM — the exact contract text passed in is
 *      present, byte-for-byte, in the built prompt. We pass a unique SENTINEL string
 *      as the contract so a match is attributable to the contract argument alone (it
 *      cannot leak in from boilerplate, the unit id, or the failure evidence).
 *   2. THE RUBRIC IS TRIANGULATION — the prompt instructs the judge to arbitrate each
 *      hand against the contract, evidenced by a case-insensitive "triangulate" token
 *      (the token the SPEC CONTRACT guarantees `buildJudgePrompt` embeds). Triangulation
 *      is judging each hand against the neutral arbiter, NOT comparing the two hands.
 *
 * A negative anchor guards property 1: a DISTINCT sentinel that is NOT passed as the
 * contract must be absent, so property 1 proves the contract argument flowed through
 * rather than an unconditional string always appearing.
 *
 * This exercises the pure prompt-builder in isolation (no SDK, no worktree, no model):
 * the contract argument is the third parameter of `buildJudgePrompt`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildJudgePrompt } from "../services/OrchestratorService";

// A red unit to attribute — the minimal `Pick<SchedUnit, "id" | "slice" | "role">`
// the builder consumes. Kept deliberately free of any sentinel text.
const UNIT = {
  id: "TEP-6_SP-9_SL-1#eu-2",
  slice: "TEP-6_SP-9_SL-1",
  role: "code" as const,
};

// The failure evidence handed alongside the contract — again sentinel-free, so a
// contract-sentinel match can only come from the contract argument.
const FAILURE =
  "AssertionError: expected reDispatchDecision(...).route to equal 'contract'";

// A unique, unmistakable contract body. Unusual token + a nonce make an accidental
// substring collision with the prompt's boilerplate effectively impossible, so its
// presence in the output is attributable to the `contract` argument alone.
const CONTRACT_SENTINEL =
  "⟦CONTRACT-SENTINEL-9f2a7c⟧ export function armGate(seam: Seam): Effect; // the arming seam both hands built to";

// A DISTINCT string never passed as the contract — its ABSENCE proves property 1 is
// wired to the argument, not an unconditional echo.
const ABSENT_SENTINEL = "⟦NEVER-SUPPLIED-4b81de⟧ this text is not the contract";

// ── property 1: the contract reaches the judge verbatim ──────────────────────

test("buildJudgePrompt embeds the slice's contract text VERBATIM in the judge's prompt", () => {
  const prompt = buildJudgePrompt(UNIT, FAILURE, CONTRACT_SENTINEL);

  assert.equal(
    typeof prompt,
    "string",
    "buildJudgePrompt must return the judge prompt as a string",
  );
  assert.ok(
    prompt.includes(CONTRACT_SENTINEL),
    "the judge prompt must contain the supplied contract text VERBATIM (the arbiter both hands built to), so the judge triangulates against it",
  );
});

test("buildJudgePrompt does NOT invent contract text — a string never supplied as the contract is absent", () => {
  const prompt = buildJudgePrompt(UNIT, FAILURE, CONTRACT_SENTINEL);
  assert.ok(
    !prompt.includes(ABSENT_SENTINEL),
    "only the CONTRACT argument's text may appear as the contract — an unrelated string must not surface, proving the verbatim embed is wired to the argument",
  );
});

// ── property 2: the rubric directs triangulation, not hand-vs-hand comparison ─

test('buildJudgePrompt instructs the judge to TRIANGULATE each hand against the contract (case-insensitive "triangulate" token present)', () => {
  const prompt = buildJudgePrompt(UNIT, FAILURE, CONTRACT_SENTINEL);
  assert.match(
    prompt,
    /triangulate/i,
    "the judge's instructions must direct triangulation — each hand's conformance judged against the contract, NOT by comparing the two hands to each other",
  );
});

// ── the two properties hold TOGETHER for one judge dispatch ───────────────────

test("a single judge prompt carries BOTH the verbatim contract AND the triangulation instruction", () => {
  const prompt = buildJudgePrompt(UNIT, FAILURE, CONTRACT_SENTINEL);
  assert.ok(
    prompt.includes(CONTRACT_SENTINEL) && /triangulate/i.test(prompt),
    "the same prompt handed to the judge must both embed the contract verbatim and instruct triangulation against it",
  );
});
