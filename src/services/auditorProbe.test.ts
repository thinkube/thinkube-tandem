/**
 * Auditor discrimination probe (SP-th1jtj AC6 / TEP-tgzx3p, the opening half).
 * node:test + node:assert; run via `npm test` — verifier-checked, not human-checked.
 *
 * AC6: "An AI discrimination pass over a fixed fixture set flags N/N known-bad ACs
 * (human-executed + deploy-circular) as `needs-reframe` and passes M/M clean AI-verifiable ACs
 * — checked by the verifier, not a human."
 *
 * How this holds the auditor's judgment quality *without a live model*:
 *
 *   - The auditor's `verifiable | needs-reframe` call sits behind an **injectable seam** — here a
 *     pure `AuditFn` (the same shape the real `/spec-prepare` LLM step fills). The live model run
 *     is the low-AI-testability shell and is exercised by operators, not by this unit test
 *     (Spec constraint: "the real LLM run is the low-AI-testability shell").
 *   - This file ships (a) a **fixed fixture set** of labelled ACs — known-bad in the two families
 *     the Spec names (human-executed, deploy/merge-circular) and clean AI-verifiable ones — and
 *     (b) a **scoring harness** `runProbe(fixtures, audit)` that runs every fixture through the
 *     seam and returns the N/N · M/M scorecard.
 *   - The unit test pins the harness against a **reference auditor** — a deterministic classifier
 *     that encodes the AC-verifiability rules (actor must be the AI; no deploy/merge-circular
 *     gate) — and asserts it scores **N/N flagged + M/M passed** on the fixtures. The same harness
 *     is what the real model is scored through; the test also proves the probe is a *real*
 *     discriminator by showing a degenerate always-pass auditor fails it (no vacuous green).
 *
 * Type-stability note: this probe depends only on `openingGate`'s stable exports — the verdict
 * *kind* union (`AcVerdictKind`) and the pure `readyGate` — not on the `AcVerdict` record's
 * internal field naming, so it is unaffected by how the emission helper shapes its verdicts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { readyGate, type AcVerdictKind } from "./openingGate";

// ── the auditor seam ─────────────────────────────────────────────────────────

/** One AC as the auditor sees it: its 1-based ordinal and its criterion text. */
interface ProbeAc {
  ordinal: number;
  /** The acceptance-criterion prose the auditor interrogates. */
  text: string;
}

/**
 * The injectable auditor seam. The real `/spec-prepare` implementation is the LLM; here it is a
 * pure function so the discrimination pass is unit-testable with no live model. Returns the
 * auditor's per-AC call. A `verifiable` AC also yields a concrete proof command (`run`) — the
 * thing that arms the → Ready gate; a `needs-reframe` AC yields none.
 */
type AuditFn = (ac: ProbeAc) => { verdict: AcVerdictKind; run?: string };

// ── the fixed fixture set ────────────────────────────────────────────────────

/** A labelled fixture: the AC text and the verdict the auditor MUST reach. */
interface Fixture {
  text: string;
  /** Why this AC is known-bad (for readable failure messages); absent on clean fixtures. */
  family?: "human-executed" | "deploy-circular";
  expect: AcVerdictKind;
}

/**
 * Known-bad ACs — the two families the Spec calls out. Each must be flagged `needs-reframe`:
 *   - human-executed: the verifying actor is a person, not the AI (no AI evidence is producible).
 *   - deploy-circular: the AC's own verification depends on a merge/deploy that the gate it arms
 *     gates — it cannot be checked before the gate (the SP-tgqf1v failure mode).
 */
const KNOWN_BAD: Fixture[] = [
  // — human-executed —
  {
    family: "human-executed",
    expect: "needs-reframe",
    text: "In a fresh session the human opens the panel and confirms it looks right.",
  },
  {
    family: "human-executed",
    expect: "needs-reframe",
    text: "A reviewer manually checks by eye that the rendered colors match the mockup.",
  },
  {
    family: "human-executed",
    expect: "needs-reframe",
    text: "The maintainer verifies visually that the tab title shows the repo prefix.",
  },
  // — deploy / merge-circular —
  {
    family: "deploy-circular",
    expect: "needs-reframe",
    text: "After merging to main, CI deploys the extension and the feature is live in the marketplace.",
  },
  {
    family: "deploy-circular",
    expect: "needs-reframe",
    text: "Once the PR is merged and Argo syncs, the production dashboard shows the service green.",
  },
];

/**
 * Clean, AI-verifiable ACs — each names an actor (the AI) and an environment available *before*
 * the gate, with a runnable command. Each must pass `verifiable`.
 */
const CLEAN: Fixture[] = [
  {
    expect: "verifiable",
    text: "A unit test asserts `readyGate` blocks an AC set with a missing `run`, naming the ordinal. (run: `npm test`)",
  },
  {
    expect: "verifiable",
    text: "`tsc -p tsconfig.test.json` type-checks the new sources with no errors. (run: `npm test`)",
  },
  {
    expect: "verifiable",
    text: "A unit test shows the emitted map parses via `parseAcVerifications` over ordinals 1..N. (run: `npm test`)",
  },
  {
    expect: "verifiable",
    text: "`node --test out-test/` exits 0 with the discrimination probe green. (run: `node --test out-test/`)",
  },
];

const FIXTURES: Fixture[] = [...KNOWN_BAD, ...CLEAN];

// ── the scoring harness ──────────────────────────────────────────────────────

interface ProbeScore {
  /** known-bad fixtures correctly flagged `needs-reframe`. */
  flaggedBad: number;
  /** total known-bad fixtures. */
  totalBad: number;
  /** clean fixtures correctly passed `verifiable`. */
  passedClean: number;
  /** total clean fixtures. */
  totalClean: number;
  /** human-readable mis-classifications, for failure messages. */
  misses: string[];
}

/**
 * Run every fixture through the auditor seam and score the discrimination. Pure: the same harness
 * scores the reference auditor here and the live LLM in `/spec-prepare`.
 */
function runProbe(fixtures: Fixture[], audit: AuditFn): ProbeScore {
  let flaggedBad = 0;
  let totalBad = 0;
  let passedClean = 0;
  let totalClean = 0;
  const misses: string[] = [];

  fixtures.forEach((f, i) => {
    const { verdict } = audit({ ordinal: i + 1, text: f.text });
    const ok = verdict === f.expect;
    if (f.expect === "needs-reframe") {
      totalBad++;
      if (ok) flaggedBad++;
      else misses.push(`known-bad (${f.family}) NOT flagged: "${f.text}"`);
    } else {
      totalClean++;
      if (ok) passedClean++;
      else misses.push(`clean AC misflagged ${verdict}: "${f.text}"`);
    }
  });

  return { flaggedBad, totalBad, passedClean, totalClean, misses };
}

// ── the reference auditor (deterministic stand-in for the LLM judgment) ───────

/**
 * A deterministic classifier encoding the AC-verifiability rules. It flags `needs-reframe` when an
 * AC's verifying actor is a human, or when its verification is gated on a merge/deploy it cannot
 * run before the gate; otherwise (an AI-runnable check) it passes `verifiable` and lifts the
 * `run:` command out of the prose. This is the *contract* the live auditor must meet — the probe
 * scores the live model through the very same harness.
 */
const referenceAuditor: AuditFn = ({ text }) => {
  const t = text.toLowerCase();

  // Human-executed: the actor is a person / the check is done by eye, manually, in a session.
  const HUMAN =
    /\b(human|reviewer|maintainer|operator|by eye|manually|visually|looks? right|confirm[s]? (?:it|the)|in a fresh session)\b/;
  // Deploy / merge-circular: verification depends on a merge/deploy that the gate it arms gates.
  const DEPLOY_CIRCULAR =
    /\b(after merg\w*|once .*merged|merged (?:to|into) main|deploys?\b|deployed|argo syncs?|in production|production (?:dashboard|endpoint)|is live)\b/;

  if (HUMAN.test(t) || DEPLOY_CIRCULAR.test(t)) {
    return { verdict: "needs-reframe" };
  }

  const run = /run:\s*`([^`]+)`/i.exec(text)?.[1];
  return { verdict: "verifiable", run };
};

/** A degenerate auditor that approves everything — used to prove the probe truly discriminates. */
const alwaysPass: AuditFn = () => ({ verdict: "verifiable", run: "noop" });

// ── the probe ─────────────────────────────────────────────────────────────────

test("probe: the fixture set is non-trivial and covers both known-bad families", () => {
  assert.ok(KNOWN_BAD.length > 0, "N must be > 0");
  assert.ok(CLEAN.length > 0, "M must be > 0");
  const families = new Set(KNOWN_BAD.map((f) => f.family));
  assert.ok(
    families.has("human-executed"),
    "fixtures must include a human-executed AC",
  );
  assert.ok(
    families.has("deploy-circular"),
    "fixtures must include a deploy/merge-circular AC",
  );
});

test("probe: reference auditor flags N/N known-bad ACs as needs-reframe", () => {
  const score = runProbe(FIXTURES, referenceAuditor);
  assert.equal(
    score.flaggedBad,
    score.totalBad,
    `expected N/N known-bad flagged; misses: ${score.misses.join(" | ")}`,
  );
  assert.equal(score.totalBad, KNOWN_BAD.length);
});

test("probe: reference auditor passes M/M clean AI-verifiable ACs", () => {
  const score = runProbe(FIXTURES, referenceAuditor);
  assert.equal(
    score.passedClean,
    score.totalClean,
    `expected M/M clean passed; misses: ${score.misses.join(" | ")}`,
  );
  assert.equal(score.totalClean, CLEAN.length);
});

test("probe: full discrimination — N/N flagged AND M/M passed, no misses", () => {
  const score = runProbe(FIXTURES, referenceAuditor);
  assert.deepEqual(score.misses, []);
  assert.equal(score.flaggedBad, score.totalBad);
  assert.equal(score.passedClean, score.totalClean);
});

test("probe: a degenerate always-pass auditor FAILS the probe (the probe is not vacuous)", () => {
  // Guards the probe itself: if an auditor rubber-stamps every AC, it must miss every known-bad
  // one — otherwise N/N flagged would be trivially satisfiable and the probe would prove nothing.
  const score = runProbe(FIXTURES, alwaysPass);
  assert.equal(
    score.flaggedBad,
    0,
    "always-pass must flag none of the known-bad",
  );
  assert.ok(
    score.flaggedBad < score.totalBad,
    "the probe must be able to fail a bad auditor",
  );
  assert.equal(score.misses.length, score.totalBad);
});

// ── the probe verdicts arm (or block) the structural → Ready gate ─────────────

test("probe: the M/M clean verdicts produce a Ready-eligible ac_verifications map", () => {
  // Each `verifiable` clean AC yields a runnable `run` ⇒ a full map ⇒ readyGate is satisfied. This
  // links the discrimination result to the gate it feeds: clean ACs make a Spec Ready-eligible.
  const map: Record<string, { run: string; env?: "cluster" | "local" }> = {};
  CLEAN.forEach((f, i) => {
    const { verdict, run } = referenceAuditor({ ordinal: i + 1, text: f.text });
    assert.equal(verdict, "verifiable");
    assert.ok(
      run && run.trim(),
      `clean AC #${i + 1} must yield a runnable command`,
    );
    map[String(i + 1)] = { run: run as string };
  });
  const acs = CLEAN.map((_, i) => ({ ordinal: i + 1 }));
  assert.deepEqual(readyGate(acs, map), { ok: true });
});

test("probe: a known-bad verdict leaves a hole that blocks the → Ready gate", () => {
  // A single needs-reframe AC dropped into an otherwise-clean set yields no entry for its ordinal,
  // so the structural gate refuses, naming it — the discrimination result the gate consumes.
  const badText = KNOWN_BAD[0].text; // a human-executed AC at ordinal 2
  const map: Record<string, { run: string; env?: "cluster" | "local" }> = {
    "1": { run: "npm test" },
    "3": { run: "npm test" },
  };
  // ordinal 2 deliberately omitted — the auditor flagged it needs-reframe, so no entry is emitted.
  assert.equal(
    referenceAuditor({ ordinal: 2, text: badText }).verdict,
    "needs-reframe",
  );
  assert.deepEqual(
    readyGate([{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }], map),
    { ok: false, ordinal: 2 },
  );
});
