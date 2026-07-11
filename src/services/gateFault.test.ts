/**
 * Gate self-healing + circuit breaker (2026-07-11, TEP-1_SP-4 post-mortem):
 *
 *  - a probe that exits 126/127 is `unrunnable` — a GATE defect, never an AC
 *    red attributable to a slice (the signed bare-`tsc` probe burned 3 rework
 *    attempts as a phantom "code failure");
 *  - `fault: "gate"` escalates WITHOUT burning a rework attempt (mirror of the
 *    `contract` arm);
 *  - identical normalized failing evidence across attempts trips the
 *    deterministic-failure circuit breaker: escalate NOW instead of burning
 *    the remaining bound on the same experiment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runAcVerifications,
  reDispatchDecision,
  normalizeEvidenceHash,
  PROBE_UNRUNNABLE_CODES,
  type AcVerification,
} from "./orchestratorCore";

const VERIFS: AcVerification[] = [
  { ac: 1, run: "tsc --noEmit", env: "local" },
  { ac: 2, run: "node --test out-test", env: "local" },
];

test("exit 127 marks the result unrunnable (gate defect), exit 1 does not", async () => {
  const exec = async (run: string) =>
    run.startsWith("tsc")
      ? { code: 127, output: "/bin/sh: 1: tsc: not found" }
      : { code: 1, output: "not ok 1 - real failing test" };
  const results = await runAcVerifications(VERIFS, "/w", exec);
  assert.equal(results[0].unrunnable, true);
  assert.match(results[0].evidence, /GATE defect/);
  assert.equal(results[0].pass, false);
  assert.equal(results[1].unrunnable, undefined);
  assert.equal(results[1].pass, false);
});

test("a spawn error is unrunnable too", async () => {
  const exec = async () => {
    throw new Error("spawn EACCES");
  };
  const results = await runAcVerifications([VERIFS[0]], "/w", exec);
  assert.equal(results[0].unrunnable, true);
});

test("PROBE_UNRUNNABLE_CODES is exactly {126, 127}", () => {
  assert.deepEqual([...PROBE_UNRUNNABLE_CODES].sort(), [126, 127]);
});

test("fault `gate` escalates without burning an attempt (mirror of `contract`)", () => {
  const v = reDispatchDecision(2, 3, "gate");
  assert.deepEqual(v, { action: "escalate", attempts: 2, route: "gate" });
});

test("identical evidence hash trips the circuit breaker at THIS attempt", () => {
  const hash = normalizeEvidenceHash("AC #5: $ x → exit 1\nboom");
  const v = reDispatchDecision(0, 3, "code", { hash, priorHash: hash });
  assert.equal(v.action, "escalate");
  assert.equal(v.deterministic, true);
  assert.equal(v.attempts, 1, "the failed attempt itself is still counted");
  assert.equal(v.route, "code");
});

test("different evidence re-dispatches normally below the bound", () => {
  const v = reDispatchDecision(0, 3, "code", {
    hash: normalizeEvidenceHash("failure A"),
    priorHash: normalizeEvidenceHash("failure B"),
  });
  assert.deepEqual(v, { action: "re-dispatch", attempts: 1, route: "code" });
});

test("missing prior hash never trips the breaker (first failure)", () => {
  const v = reDispatchDecision(0, 3, "code", {
    hash: normalizeEvidenceHash("failure A"),
    priorHash: undefined,
  });
  assert.equal(v.action, "re-dispatch");
});

test("evidence normalization ignores volatile fragments, keeps the failure", () => {
  const a = normalizeEvidenceHash(
    "duration_ms: 40.39\n2026-07-11T10:00:00Z /tmp/tk-abc123/x.ts not ok 1 - boom (took 3.2s) pid=411",
  );
  const b = normalizeEvidenceHash(
    "duration_ms: 99.99\n2026-07-12T22:13:07Z /tmp/tk-zzz999/x.ts not ok 1 - boom (took 88ms) pid=7",
  );
  assert.equal(a, b, "volatile-only differences hash identically");
  const c = normalizeEvidenceHash(
    "duration_ms: 40.39\n2026-07-11T10:00:00Z /tmp/tk-abc123/x.ts not ok 1 - DIFFERENT failure pid=411",
  );
  assert.notEqual(a, c, "a real failure change hashes differently");
});
