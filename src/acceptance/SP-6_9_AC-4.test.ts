/**
 * SP-6/9 (TEP-6) AC4 — the widened `Fault` type changes NO existing route.
 *
 * SP-6/9 adds a fourth fault kind (`contract`) and a new escalation arm to the pure re-dispatch
 * decision. AC4 is the regression guard on the OTHER three kinds: adding `contract` must leave the
 * pre-existing routing of `code`, `test`, and `both` byte-for-byte unchanged. Concretely, with a
 * prior attempt count WELL BELOW the bound:
 *
 *   • a `code` fault RE-DISPATCHES — action "re-dispatch", route "code", attempts === prior+1;
 *   • a `test` fault RE-DISPATCHES — action "re-dispatch", route "test", attempts === prior+1;
 *   • a `both` fault ESCALATES even below the bound (ambiguous — neither hand can be singled out) —
 *     action "escalate", route "both".
 *
 * And the attempt counter increments by exactly one ONLY in the re-dispatch cases: `code`/`test`
 * burn an attempt (prior+1); `both` — like `contract` — escalates, but AC4 pins ONLY the three
 * pre-existing kinds (the `contract`-specific no-burn behaviour is AC1's concern). Here we assert
 * the +1 increment lands on the two re-dispatch routes.
 *
 * This exercises ONLY the public interface in the SPEC CONTRACT (`reDispatchDecision`) — it makes no
 * assumption about the internal implementation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reDispatchDecision,
  type ReDispatchVerdict,
  type Fault,
} from "../services/orchestratorCore";

// A prior count deliberately WELL BELOW every bound we use, so a code/test fault is unambiguously in
// the re-dispatch regime (the attempt budget is not the thing under test — the route is).
const PRIOR = 0;
const BOUND = 10;

test("AC4: a `code` fault below the bound re-dispatches to the code role, burning one attempt (prior+1)", () => {
  const verdict: ReDispatchVerdict = reDispatchDecision(PRIOR, BOUND, "code");

  assert.equal(
    verdict.action,
    "re-dispatch",
    "a code fault well below the bound must RE-DISPATCH (not escalate) — routing unchanged by the widening",
  );
  assert.equal(
    verdict.route,
    "code",
    "the re-dispatch must be routed to the `code` hand",
  );
  assert.equal(
    verdict.attempts,
    PRIOR + 1,
    "a code re-dispatch increments the attempt counter by exactly one (prior+1)",
  );
});

test("AC4: a `test` fault below the bound re-dispatches to the test role, burning one attempt (prior+1)", () => {
  const verdict: ReDispatchVerdict = reDispatchDecision(PRIOR, BOUND, "test");

  assert.equal(
    verdict.action,
    "re-dispatch",
    "a test fault well below the bound must RE-DISPATCH (not escalate) — routing unchanged by the widening",
  );
  assert.equal(
    verdict.route,
    "test",
    "the re-dispatch must be routed to the `test` hand",
  );
  assert.equal(
    verdict.attempts,
    PRIOR + 1,
    "a test re-dispatch increments the attempt counter by exactly one (prior+1)",
  );
});

test("AC4: a `both` fault ESCALATES even well below the bound (ambiguous — neither hand can be singled out)", () => {
  const verdict: ReDispatchVerdict = reDispatchDecision(PRIOR, BOUND, "both");

  assert.equal(
    verdict.action,
    "escalate",
    "a `both` fault is ambiguous and must ESCALATE regardless of remaining attempts — unchanged by the widening",
  );
  assert.equal(
    verdict.route,
    "both",
    "the escalation still carries the `both` route",
  );
});

test("AC4: the +1 increment lands ONLY on the re-dispatch cases (code/test), across several below-bound priors", () => {
  // Sweep a few (prior, bound) pairs that are all comfortably below the bound, so the code/test
  // routing decision is stable, and confirm the attempt counter advances by exactly one on each
  // re-dispatch. The `both` case escalates in the same neighbourhood — its route is `both`, and it
  // is NOT one of the two re-dispatch routes, which is the whole point of "increments only in the
  // re-dispatch cases."
  const belowBound: Array<[prior: number, bound: number]> = [
    [0, 10],
    [1, 10],
    [2, 5],
    [0, 3],
    [1, 3], // still one below the default-ish bound → re-dispatch, not escalate.
  ];

  for (const [prior, bound] of belowBound) {
    const where = `prior=${prior}, bound=${bound}`;

    const asCode = reDispatchDecision(prior, bound, "code");
    assert.equal(
      asCode.action,
      "re-dispatch",
      `code below the bound re-dispatches — ${where}`,
    );
    assert.equal(asCode.route, "code", `code route preserved — ${where}`);
    assert.equal(
      asCode.attempts,
      prior + 1,
      `code re-dispatch increments attempts by one — ${where}`,
    );

    const asTest = reDispatchDecision(prior, bound, "test");
    assert.equal(
      asTest.action,
      "re-dispatch",
      `test below the bound re-dispatches — ${where}`,
    );
    assert.equal(asTest.route, "test", `test route preserved — ${where}`);
    assert.equal(
      asTest.attempts,
      prior + 1,
      `test re-dispatch increments attempts by one — ${where}`,
    );

    const asBoth = reDispatchDecision(prior, bound, "both");
    assert.equal(
      asBoth.action,
      "escalate",
      `both escalates even below the bound — ${where}`,
    );
    assert.notEqual(
      asBoth.route,
      "code",
      `a both fault is not routed to code — ${where}`,
    );
    assert.notEqual(
      asBoth.route,
      "test",
      `a both fault is not routed to test — ${where}`,
    );
  }
});

test("AC4: the three pre-existing routes are self-consistent — only code/test re-dispatch, and each carries its own route", () => {
  // A compact table pinning the full (action, route) tuple for each pre-existing kind at one shared,
  // well-below-bound point — the single source of truth for "the widening changed no current route."
  const expected: Array<{
    fault: Fault;
    action: ReDispatchVerdict["action"];
    route: Fault;
  }> = [
    { fault: "code", action: "re-dispatch", route: "code" },
    { fault: "test", action: "re-dispatch", route: "test" },
    { fault: "both", action: "escalate", route: "both" },
  ];

  for (const { fault, action, route } of expected) {
    const verdict = reDispatchDecision(PRIOR, BOUND, fault);
    assert.equal(
      verdict.action,
      action,
      `${fault} fault → action ${action} (unchanged by the fault-kind widening)`,
    );
    assert.equal(
      verdict.route,
      route,
      `${fault} fault → route ${route} (unchanged by the fault-kind widening)`,
    );
  }
});
