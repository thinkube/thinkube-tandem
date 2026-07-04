/**
 * SP-6/9 (TEP-6) AC1 — a red slice judged `fault: contract` is NEVER re-dispatched to a role.
 *
 * The contract itself is the arbiter: when both hands conform to the contract yet still
 * disagree — or the red pivots on a seam the contract never defined — the defect is the
 * CONTRACT, not the slice. Routing that as `code`/`test` would burn bounded rework attempts
 * re-guessing the seam and escalate without ever naming the real problem. The fix is the pure,
 * deterministic re-dispatch decision's **contract arm**: `fault === "contract"` short-circuits
 * to escalation, does NOT burn a rework attempt (the slice was never the problem), and carries
 * the `contract` route — REGARDLESS of the prior attempt count or the bound. A durable marker
 * (`CONTRACT_DEFECT_MARKER`) names the contract as the defect so the requires-attention diagnosis
 * directs to a contract re-cut, not a re-queue.
 *
 * This exercises ONLY the public interface in the SPEC CONTRACT (`reDispatchDecision`,
 * `CONTRACT_DEFECT_MARKER`) — it makes no assumption about the internal implementation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reDispatchDecision,
  CONTRACT_DEFECT_MARKER,
  type ReDispatchVerdict,
} from "../services/orchestratorCore";

// ── AC1 core: fault==="contract" ⇒ escalate WITHOUT burning an attempt ────────
//
// The contract arm must hold across the whole space of (priorAttempts, bound) — crucially it
// must escalate even WELL BELOW the bound (where a code/test fault would still re-dispatch),
// because the number of remaining rework attempts is irrelevant when the slice was never at
// fault. Each case pins all three observable facts at once: action "escalate", attempts UNCHANGED
// (=== the prior count — no +1 burn), and route "contract".

test("AC1: reDispatchDecision routes a `contract` fault to escalation without spending a rework attempt, regardless of prior/bound", () => {
  // (priorAttempts, bound) pairs — deliberately spanning: well below the bound (fresh slice with
  // ample attempts left), one below the bound, exactly at the bound, and past it. The verdict is
  // identical across ALL of them — the contract arm is independent of the attempt budget.
  const cases: Array<[prior: number, bound: number | undefined]> = [
    [0, 10], // WELL below the bound — a code/test fault here would re-dispatch; contract must not.
    [0, 3], // fresh slice at the default-ish bound.
    [1, 5], // below the bound.
    [2, 3], // one below the default bound.
    [3, 3], // at the bound.
    [7, 3], // past the bound.
    [0, undefined], // default bound (bound omitted) — still escalates, still no burn.
    [4, undefined], // default bound, mid-run.
  ];

  for (const [prior, bound] of cases) {
    const verdict: ReDispatchVerdict = reDispatchDecision(
      prior,
      bound,
      "contract",
    );
    const where = `prior=${prior}, bound=${String(bound)}`;

    assert.equal(
      verdict.action,
      "escalate",
      `a contract fault must ESCALATE immediately (not re-dispatch) — ${where}`,
    );
    assert.equal(
      verdict.attempts,
      prior,
      `a contract fault must NOT burn a rework attempt — the count stays === the prior count (${where})`,
    );
    assert.equal(
      verdict.route,
      "contract",
      `the escalation must carry the "contract" route so the slice goes to a contract re-cut — ${where}`,
    );
  }
});

test("AC1: the contract arm escalates well below the bound where a code/test fault would still re-dispatch (contrast)", () => {
  // Same prior + bound; only the fault differs. `code`/`test` (below the bound) re-dispatch and
  // BURN an attempt (prior+1); `contract` escalates and burns nothing. This isolates the contract
  // arm as the cause — it is not an always-escalating gate, it is fault-specific.
  const prior = 0;
  const bound = 10;

  const asCode = reDispatchDecision(prior, bound, "code");
  assert.equal(
    asCode.action,
    "re-dispatch",
    "a code fault below the bound re-dispatches",
  );
  assert.equal(
    asCode.attempts,
    prior + 1,
    "a code re-dispatch burns an attempt (prior+1)",
  );
  assert.equal(asCode.route, "code");

  const asTest = reDispatchDecision(prior, bound, "test");
  assert.equal(
    asTest.action,
    "re-dispatch",
    "a test fault below the bound re-dispatches",
  );
  assert.equal(
    asTest.attempts,
    prior + 1,
    "a test re-dispatch burns an attempt (prior+1)",
  );
  assert.equal(asTest.route, "test");

  const asContract = reDispatchDecision(prior, bound, "contract");
  assert.equal(
    asContract.action,
    "escalate",
    "the SAME prior/bound with a contract fault escalates instead — the attempt budget is irrelevant",
  );
  assert.equal(
    asContract.attempts,
    prior,
    "the contract escalation leaves the attempt count untouched (no burn), unlike code/test",
  );
  assert.equal(asContract.route, "contract");
});

// ── AC1: the durable contract-defect marker names the contract as the defect ──
//
// The escalation must be human-facing and reload-surviving, and it must NAME the contract (so
// the requires-attention diagnosis reads "the contract is incomplete … re-cut it", not a generic
// escalation). Asserting a SUBSTRING (/contract/i) — never an exact-glyph equality — so the exact
// wording/emoji can evolve without breaking this pin.

test("AC1: CONTRACT_DEFECT_MARKER is a non-empty string that names the contract", () => {
  assert.equal(
    typeof CONTRACT_DEFECT_MARKER,
    "string",
    "the durable contract-defect marker is a string constant",
  );
  assert.ok(
    CONTRACT_DEFECT_MARKER.trim().length > 0,
    "the contract-defect marker must be non-empty",
  );
  assert.match(
    CONTRACT_DEFECT_MARKER,
    /contract/i,
    "the marker must NAME the contract as the defect (substring, not exact-glyph equality)",
  );
});
