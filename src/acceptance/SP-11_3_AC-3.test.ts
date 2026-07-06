/**
 * SP-11/3 (TEP-11) AC3 — "Evidence demoted": raw verification output (runner dumps, probe
 * transcripts) appears ONLY under the `## Evidence appendix` heading, after all the human
 * sections — NO fenced runner output appears before that heading.
 *
 * DELIVERY.md becomes the operator's document, so the fenced runner dumps and the machine
 * verification-trace table are demoted to a trailing evidence appendix. The SPEC CONTRACT pins the
 * section order and the appendix's contents exactly:
 *
 *   buildDeliveryReport section order (headings exact):
 *     "# Delivery — …" → "## What happened" → "## Acceptance criteria"
 *     → "## Discoveries & recommendations" → "## Files" → "## Next" → "## Evidence appendix"
 *   Evidence appendix: per-AC fenced evidence blocks AND the verification trace table, after all
 *   sections above.
 *
 * This exercises ONLY the public `buildDeliveryReport` interface via its `DeliveryReportInput`
 * shape — it makes NO assumption about the internal implementation, only about the contract's
 * section order and the demotion guarantee. The report is fed acResults whose `evidence` carries a
 * distinctive runner-output token AND a `trace` entry whose rationale carries a second distinctive
 * token; the assertions are that (a) NO ``` fence occurs before the `## Evidence appendix` heading,
 * and (b) both the fenced evidence and the trace token render AFTER it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDeliveryReport,
  type DeliveryReportInput,
  type AcVerification,
  type AcResult,
  type VerificationTraceEntry,
} from "../services/orchestratorCore";

// The exact heading the SPEC CONTRACT demotes all raw verification output under. Matched as a
// whole trimmed line so an incidental substring elsewhere can never be mistaken for the heading.
const APPENDIX_HEADING = "## Evidence appendix";

// Two distinctive tokens that appear NOWHERE in the human sections' inputs, so finding either one
// proves it travelled through the RAW-evidence channel — not the diagnosis / AC-text / discovery
// prose. `Ω`/`Δ` + a hex tail make them un-guessable and un-collidable with the report scaffold.
const EVIDENCE_TOKEN = "«runner-dump-Ω-a71f3e»";
const TRACE_TOKEN = "«trace-rationale-Δ-5c9b02»";

// Multi-line runner output — the kind of raw dump the report wraps in a ``` fence. The distinctive
// token sits on its own line so its survival into a fenced appendix block is unambiguous.
const AC2_EVIDENCE =
  "$ node --test out-test/acceptance/SP-11_3_AC-3.test.js → exit 1\n" +
  `not ok 1 - evidence demoted\n${EVIDENCE_TOKEN}\n  ---\n  Error: assertion failed\n  ...`;

const DECLARED: AcVerification[] = [
  {
    ac: 1,
    run: "node --test out-test/acceptance/SP-11_3_AC-1.test.js",
    env: "local",
  },
  {
    ac: 2,
    run: "node --test out-test/acceptance/SP-11_3_AC-3.test.js",
    env: "local",
  },
];

// AC1 green, AC2 red (its evidence carries the runner-dump token) — a realistic FAILED run whose
// raw output must be demoted to the appendix.
const AC_RESULTS: AcResult[] = [
  { ac: 1, pass: true, evidence: "$ run 1 → exit 0\nok 1 - all good" },
  { ac: 2, pass: false, evidence: AC2_EVIDENCE },
];

// A verification-trace entry whose rationale carries the second distinctive token. Kept short and
// token-first so the trace table's 160-char rationale clip can never drop it.
const TRACE: VerificationTraceEntry[] = [
  {
    ac: 1,
    round: 1,
    kind: "probe",
    verdict: "pass",
    rationale: "ok 1 - all good",
  },
  {
    ac: 2,
    round: 1,
    kind: "probe",
    verdict: "fail",
    rationale: `${TRACE_TOKEN} — held-out probe evidence tail`,
    route: "test",
  },
];

// The AC criterion lines (index k-1 ↔ AC k) — plain prose with no fences, so the human `##
// Acceptance criteria` section stays fence-free and the demotion assertion is about the evidence
// channel alone.
const AC_TEXTS = [
  "What happened is the first section after the Delivery title line.",
  "Raw verification output appears only under the Evidence appendix heading.",
];

function buildInput(
  overrides: Partial<DeliveryReportInput> = {},
): DeliveryReportInput {
  return {
    specNumber: "11/3",
    sha: "abc1234",
    files: ["src/services/orchestratorCore.ts"],
    units: [{ id: "SP-11_3_SL-1#eu-2", outcome: "failed" }],
    declared: DECLARED,
    acResults: AC_RESULTS,
    advanced: [],
    committed: false,
    // A FAILED run (committed:false + AC2 pass:false) → What happened renders this diagnosis as
    // plain prose. Deliberately fence-free and token-free, so it can't confound the demotion checks.
    diagnosis: [
      {
        ac: 2,
        text: "The held-out probe pinned a runner detail the new layout demoted into the appendix, so its assertion diverged from the delivered behaviour rather than catching a regression.",
      },
    ],
    acTexts: AC_TEXTS,
    trace: TRACE,
    ...overrides,
  };
}

/**
 * Split a report at the EXACT `## Evidence appendix` heading LINE. Returns the text before the
 * heading and the text after it (the heading line itself excluded from both), so the two halves
 * can be searched independently for fences / tokens.
 */
function splitAtAppendix(report: string): { before: string; after: string } {
  const lines = report.split(/\r?\n/);
  const h = lines.findIndex((l) => l.trim() === APPENDIX_HEADING);
  assert.notEqual(
    h,
    -1,
    `the report must contain an exact \`${APPENDIX_HEADING}\` heading line`,
  );
  return {
    before: lines.slice(0, h).join("\n"),
    after: lines.slice(h + 1).join("\n"),
  };
}

// ── AC3 core: no ``` fence before the appendix; the fenced evidence + trace token come AFTER ────
//
// The heart of "evidence demoted": everything a reader meets before `## Evidence appendix` is human
// prose, so NOT ONE ``` fence may appear there. The raw runner dump (fenced) and the machine
// verification-trace token both belong to the appendix, so both must render after the heading.

test("AC3: no ``` fence appears before `## Evidence appendix`; the fenced evidence + trace token render after it", () => {
  const report = buildDeliveryReport(buildInput());
  const { before, after } = splitAtAppendix(report);

  // (a) NO fenced runner output before the appendix heading — the demotion guarantee.
  assert.ok(
    !before.includes("```"),
    `no \`\`\` fence may appear before \`${APPENDIX_HEADING}\` — got fenced content before it:\n${before}`,
  );

  // (b) the fenced evidence renders AFTER the heading — a ``` fence opens ahead of the runner-dump
  //     token, so the token is genuinely wrapped in an appendix code block (not bare prose).
  const fencePos = after.indexOf("```");
  const tokenPos = after.indexOf(EVIDENCE_TOKEN);
  assert.notEqual(
    fencePos,
    -1,
    "a fenced evidence block must render under the Evidence appendix",
  );
  assert.notEqual(
    tokenPos,
    -1,
    "the raw runner-dump evidence must render under the Evidence appendix",
  );
  assert.ok(
    fencePos < tokenPos,
    "the runner-dump token must sit INSIDE a fenced block under the appendix (fence opens before it)",
  );

  // (c) the machine verification-trace token also renders AFTER the heading (trace table demoted).
  assert.ok(
    after.includes(TRACE_TOKEN),
    "the verification-trace rationale token must render under the Evidence appendix",
  );
});

// ── AC3: the raw-evidence channel is demoted ENTIRELY — its tokens appear ONLY after the heading ──
//
// The negative half: neither the fenced runner dump nor the trace rationale may leak into the human
// sections. Both distinctive tokens must be ABSENT before the heading and PRESENT after it.

test("AC3: the runner-dump and trace tokens appear only AFTER `## Evidence appendix`, never before", () => {
  const report = buildDeliveryReport(buildInput());
  const { before, after } = splitAtAppendix(report);

  for (const [label, token] of [
    ["runner-dump evidence", EVIDENCE_TOKEN],
    ["verification-trace rationale", TRACE_TOKEN],
  ] as const) {
    assert.ok(
      !before.includes(token),
      `the ${label} token must NOT appear before \`${APPENDIX_HEADING}\``,
    );
    assert.ok(
      after.includes(token),
      `the ${label} token must appear under \`${APPENDIX_HEADING}\``,
    );
  }
});

// ── AC3: the appendix is LAST — it follows every human section (order per the SPEC CONTRACT) ─────
//
// "after all human sections": the appendix heading must come after the `## Next` heading (the
// contract's last pre-appendix section, which holds in both the hard-coded and state-aware-exits
// worlds), and no `## ` heading may follow the appendix — it is the final section.

test("AC3: `## Evidence appendix` is the final section — it follows `## Next` and nothing follows it", () => {
  const report = buildDeliveryReport(buildInput());
  const lines = report.split(/\r?\n/);

  const nextIdx = lines.findIndex((l) => l.trim() === "## Next");
  const appendixIdx = lines.findIndex((l) => l.trim() === APPENDIX_HEADING);

  assert.notEqual(nextIdx, -1, "the report must contain a `## Next` section");
  assert.notEqual(
    appendixIdx,
    -1,
    `the report must contain a \`${APPENDIX_HEADING}\` section`,
  );
  assert.ok(
    nextIdx < appendixIdx,
    "`## Evidence appendix` must render AFTER `## Next` (raw evidence trails the human sections)",
  );

  // No `## ` section heading may follow the appendix — it is the trailing section.
  const trailingHeadings = lines
    .slice(appendixIdx + 1)
    .filter((l) => /^##\s+\S/.test(l));
  assert.deepEqual(
    trailingHeadings,
    [],
    `no \`## \` section may follow \`${APPENDIX_HEADING}\`; found: ${JSON.stringify(trailingHeadings)}`,
  );
});
