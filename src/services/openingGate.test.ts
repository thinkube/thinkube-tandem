/**
 * Unit tests for the opening AC-verifiability gate (SP-th1jtj / TEP-tgzx3p, the *opening* half).
 * node:test + node:assert; run via `npm test`.
 *
 * These tests pin the structural gate's contract — the LLM auditor's `verifiable | needs-reframe`
 * judgment quality is the low-AI-testability shell and is exercised elsewhere (the discrimination
 * probe). Here we cover the pure, deterministic core:
 *
 *   1. `readyGate(acs, verifications)` over fixtures — all-verifiable → pass; one needs-reframe
 *      (⇒ no emitted entry) → block; one missing-`run` (ordinal absent) → block, naming the
 *      first offending ordinal.
 *   2. `emitAcVerifications(verdicts)` — given certified verdicts, the exact frontmatter map
 *      (ordinal → { run, env }) is produced, exactly one entry per `verifiable` AC; a
 *      `needs-reframe` AC gets no entry (so the structural gate blocks it).
 *   3. Round-trip: the emitted map parses through the *shipped closing gate*'s
 *      `parseAcVerifications` covering every ordinal `1..N` with no orphan / missing ordinals —
 *      the assertion that links both halves and guards the SP-tgqf1v failure from recurring.
 *
 * Assumed `./openingGate` contract (pinned by SP-th1jtj_SL-1's shared convention, extended the
 * minimal way the spec implies for the emission helper). The implementation unit owns this shape:
 *
 *   type AcVerdictKind = "verifiable" | "needs-reframe";
 *   interface AcVerdict {
 *     ordinal: number;
 *     verdict: AcVerdictKind;             // the auditor's call
 *     run?: string;                       // required for a `verifiable` AC to emit an entry
 *     env?: "cluster" | "local";
 *     why?: string;                       // reason a `needs-reframe` AC was rejected
 *   }
 *   type ReadyGateResult = { ok: true } | { ok: false; ordinal: number };
 *   function readyGate(
 *     acs: { ordinal: number }[],
 *     verifications: Record<string, { run: string; env?: "cluster" | "local" }>,
 *   ): ReadyGateResult;
 *   function emitAcVerifications(
 *     verdicts: AcVerdict[],
 *   ): Record<string, { run: string; env?: "cluster" | "local" }>;
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { readyGate, emitAcVerifications, type AcVerdict } from "./openingGate";
import { parseAcVerifications } from "./orchestratorCore";

// ── helpers ────────────────────────────────────────────────────────────────

/** Build `acs` for `readyGate` — the ordered AC ordinals 1..n. */
const acs = (n: number): { ordinal: number }[] =>
  Array.from({ length: n }, (_, i) => ({ ordinal: i + 1 }));

/** A fully-runnable verifications map for ordinals 1..n. */
const fullMap = (
  n: number,
): Record<string, { run: string; env?: "cluster" | "local" }> => {
  const out: Record<string, { run: string; env?: "cluster" | "local" }> = {};
  for (let i = 1; i <= n; i++) out[String(i)] = { run: `npm test -- ac${i}` };
  return out;
};

// ── readyGate fixtures ───────────────────────────────────────────────────────

test("readyGate: every AC certified + runnable → Ready-eligible (ok)", () => {
  const result = readyGate(acs(3), fullMap(3));
  assert.deepEqual(result, { ok: true });
});

test("readyGate: a single AC with a full declaration is eligible", () => {
  assert.deepEqual(
    readyGate(acs(1), { "1": { run: "make verify", env: "cluster" } }),
    { ok: true },
  );
});

test("readyGate: env is informational — its absence does not block", () => {
  assert.deepEqual(
    readyGate(acs(2), {
      "1": { run: "a", env: "local" },
      "2": { run: "b" }, // no env
    }),
    { ok: true },
  );
});

test("readyGate: one AC missing its run (ordinal absent) → blocked, naming that ordinal", () => {
  // AC #2 was never declared a runnable verification.
  const map = { "1": { run: "a" }, "3": { run: "c" } };
  assert.deepEqual(readyGate(acs(3), map), { ok: false, ordinal: 2 });
});

test("readyGate: names the FIRST offending ordinal, not a later one", () => {
  // Both 2 and 3 are undeclared — the lowest, 2, is reported.
  assert.deepEqual(readyGate(acs(3), { "1": { run: "a" } }), {
    ok: false,
    ordinal: 2,
  });
});

test("readyGate: a needs-reframe AC gets no emitted entry, so the gate blocks it", () => {
  // The auditor certified AC #2 as needs-reframe ⇒ emitAcVerifications writes no entry for it ⇒
  // the structural gate refuses, naming #2. This is the spec's "needs-reframe ⇒ block" path.
  const verdicts: AcVerdict[] = [
    { ordinal: 1, verdict: "verifiable", run: "a" },
    { ordinal: 2, verdict: "needs-reframe", why: "human-executed check" },
    { ordinal: 3, verdict: "verifiable", run: "c" },
  ];
  const map = emitAcVerifications(verdicts);
  assert.deepEqual(readyGate(acs(3), map), { ok: false, ordinal: 2 });
});

test("readyGate: no AC declared at all → blocked at ordinal 1", () => {
  assert.deepEqual(readyGate(acs(2), {}), { ok: false, ordinal: 1 });
});

test("readyGate: a declaration with an empty/whitespace run does not count as runnable", () => {
  // Defensive: even if a blank `run` slips into the map, the AC is not runnable.
  const map = { "1": { run: "   " }, "2": { run: "ok" } } as Record<
    string,
    { run: string; env?: "cluster" | "local" }
  >;
  assert.deepEqual(readyGate(acs(2), map), { ok: false, ordinal: 1 });
});

// ── emission helper ──────────────────────────────────────────────────────────

test("emitAcVerifications: certified verdicts → exact frontmatter map, one entry per AC", () => {
  const verdicts: AcVerdict[] = [
    { ordinal: 1, verdict: "verifiable", run: "npm test -- a", env: "local" },
    { ordinal: 2, verdict: "verifiable", run: "make verify", env: "cluster" },
    { ordinal: 3, verdict: "verifiable", run: "npm run check" },
  ];
  assert.deepEqual(emitAcVerifications(verdicts), {
    "1": { run: "npm test -- a", env: "local" },
    "2": { run: "make verify", env: "cluster" },
    "3": { run: "npm run check" },
  });
});

test("emitAcVerifications: a needs-reframe AC produces no entry", () => {
  const verdicts: AcVerdict[] = [
    { ordinal: 1, verdict: "verifiable", run: "a" },
    { ordinal: 2, verdict: "needs-reframe", why: "deploy-circular" },
  ];
  const map = emitAcVerifications(verdicts);
  assert.deepEqual(map, { "1": { run: "a" } });
  assert.ok(!("2" in map), "needs-reframe AC must not appear in the map");
});

test("emitAcVerifications: a verifiable verdict without a run emits nothing for it", () => {
  // A verifiable judgment that failed to supply a concrete command can't arm the gate.
  const verdicts: AcVerdict[] = [
    { ordinal: 1, verdict: "verifiable" }, // no run
    { ordinal: 2, verdict: "verifiable", run: "ok" },
  ];
  assert.deepEqual(emitAcVerifications(verdicts), { "2": { run: "ok" } });
});

test("emitAcVerifications: an unknown env is dropped (only cluster|local survive)", () => {
  const verdicts = [
    { ordinal: 1, verdict: "verifiable", run: "a", env: "staging" },
  ] as unknown as AcVerdict[];
  assert.deepEqual(emitAcVerifications(verdicts), { "1": { run: "a" } });
});

test("emitAcVerifications: keys are strings sorted by ordinal (low-diff write)", () => {
  const verdicts: AcVerdict[] = [
    { ordinal: 3, verdict: "verifiable", run: "c" },
    { ordinal: 1, verdict: "verifiable", run: "a" },
    { ordinal: 2, verdict: "verifiable", run: "b" },
  ];
  assert.deepEqual(Object.keys(emitAcVerifications(verdicts)), ["1", "2", "3"]);
});

test("emitAcVerifications: an all-clean AC set passes readyGate end-to-end", () => {
  const verdicts: AcVerdict[] = [
    { ordinal: 1, verdict: "verifiable", run: "a" },
    { ordinal: 2, verdict: "verifiable", run: "b" },
  ];
  assert.deepEqual(readyGate(acs(2), emitAcVerifications(verdicts)), {
    ok: true,
  });
});

// ── round-trip through the shipped closing gate ──────────────────────────────

test("round-trip: emitted map parses via parseAcVerifications covering every ordinal 1..N", () => {
  const N = 4;
  const verdicts: AcVerdict[] = Array.from({ length: N }, (_, i) => ({
    ordinal: i + 1,
    verdict: "verifiable",
    run: `verify-ac${i + 1}`,
    env: i % 2 === 0 ? "cluster" : "local",
  }));

  const map = emitAcVerifications(verdicts);
  const parsed = parseAcVerifications(map);

  // Every ordinal 1..N present, in order — no missing.
  assert.deepEqual(
    parsed.map((v) => v.ac),
    [1, 2, 3, 4],
  );
  // No orphans: every parsed ordinal lies within 1..N.
  for (const v of parsed) {
    assert.ok(v.ac >= 1 && v.ac <= N, `orphan ordinal ${v.ac} outside 1..${N}`);
  }
  // The set of declared ordinals equals exactly {1..N}.
  assert.deepEqual(new Set(parsed.map((v) => v.ac)), new Set([1, 2, 3, 4]));
  // Payloads survive the round-trip.
  assert.deepEqual(
    parsed.map((v) => ({ ac: v.ac, run: v.run, env: v.env })),
    [
      { ac: 1, run: "verify-ac1", env: "cluster" },
      { ac: 2, run: "verify-ac2", env: "local" },
      { ac: 3, run: "verify-ac3", env: "cluster" },
      { ac: 4, run: "verify-ac4", env: "local" },
    ],
  );
});

test("round-trip: a Ready-eligible map proves all N ACs (gate ⇄ closing-gate agree)", () => {
  // If readyGate says ok, parseAcVerifications must yield a runnable check for each AC ordinal —
  // this is exactly the invariant that was missing on SP-tgqf1v.
  const N = 3;
  const verdicts: AcVerdict[] = acs(N).map((a) => ({
    ordinal: a.ordinal,
    verdict: "verifiable",
    run: `r${a.ordinal}`,
  }));
  const map = emitAcVerifications(verdicts);

  assert.deepEqual(readyGate(acs(N), map), { ok: true });

  const parsedOrdinals = new Set(parseAcVerifications(map).map((v) => v.ac));
  for (const a of acs(N)) {
    assert.ok(
      parsedOrdinals.has(a.ordinal),
      `AC #${a.ordinal} is Ready-eligible but has no parseable verification`,
    );
  }
});

test("round-trip: a blocked (needs-reframe) AC set leaves a hole the closing gate sees", () => {
  const verdicts: AcVerdict[] = [
    { ordinal: 1, verdict: "verifiable", run: "r1" },
    { ordinal: 2, verdict: "needs-reframe", why: "human-executed" },
    { ordinal: 3, verdict: "verifiable", run: "r3" },
  ];
  const map = emitAcVerifications(verdicts);

  // The structural gate refuses, naming the offending ordinal …
  assert.deepEqual(readyGate(acs(3), map), { ok: false, ordinal: 2 });
  // … and the closing gate would likewise have no check for AC #2.
  const parsedOrdinals = new Set(parseAcVerifications(map).map((v) => v.ac));
  assert.ok(
    !parsedOrdinals.has(2),
    "AC #2 must have no parseable verification",
  );
});
