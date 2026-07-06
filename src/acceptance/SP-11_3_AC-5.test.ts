/**
 * SP-11/3 (TEP-11) AC5 — "Redaction confined".
 *
 * The redaction boundary is now structural and one-directional:
 *
 *   • The HUMAN document is NEVER redacted. Ordinal / command / output tokens that are present
 *     in the builder's inputs (the judge's `diagnosis`) appear VERBATIM in the built report —
 *     the operator reading DELIVERY.md sees the real mechanism, `AC #3` and `$ npm test → exit 1`
 *     and fenced runner output included.
 *
 *   • The attend/rework DIVERGENCE derived from that same report is the redacted artefact:
 *     `stripFailingCheck(extractDiagnosis(report) ?? "")` — the report's `## What happened`
 *     diagnosis routed through the existing `stripFailingCheck` — carries NO AC ordinals, NO
 *     `$ …`-command lines, and NO code fences, so a fixer can't optimise "make assertion X pass".
 *
 * This exercises ONLY the public interface pinned in the SPEC CONTRACT (`buildDeliveryReport` +
 * `DeliveryReportInput`, `extractDiagnosis`, `stripFailingCheck`) — it makes no assumption about
 * the internal report layout, only about the verbatim guarantee and the redacted derivation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDeliveryReport,
  extractDiagnosis,
  stripFailingCheck,
  type DeliveryReportInput,
} from "../services/orchestratorCore";

// ── fixtures ────────────────────────────────────────────────────────────────

/** A complete, valid report input; per-test overrides flip it to a failed run with a diagnosis. */
function makeInput(
  overrides: Partial<DeliveryReportInput> = {},
): DeliveryReportInput {
  return {
    specNumber: "11/3",
    sha: "abc1234",
    files: ["src/services/orchestratorCore.ts"],
    units: [{ id: "SP-11_3_SL-1#eu-0", outcome: "success" }],
    declared: [{ ac: 1, run: "node --test out-test/x.js", env: "local" }],
    acResults: [
      {
        ac: 1,
        pass: true,
        evidence: "$ node --test out-test/x.js → exit 0\nok",
      },
    ],
    advanced: ["SP-11_3_SL-1"],
    committed: true,
    ...overrides,
  };
}

// The two redaction-channel tokens the criterion names, placed MID-TEXT inside a prose diagnosis:
//   • an AC ordinal token — `AC #3`;
//   • a failing run command token — `$ npm test → exit 1`.
const ORDINAL_TOKEN = "AC #3";
const COMMAND_TOKEN = "$ npm test → exit 1";
// A distinctive tail so the verbatim-in-report check can't pass on an incidental substring.
const DIAG_TAIL = "«diag-tail-Ω-5c1a9f»";

/**
 * A realistic judge diagnosis: prose carrying the ordinal + command tokens mid-sentence, PLUS a
 * standalone `$ …`-command line and a fenced runner-output block — the three channels
 * `stripFailingCheck` is defined to remove. The builder must render ALL of it verbatim in the
 * human report; the derived divergence must contain NONE of it.
 */
const DIAGNOSIS = [
  `The held-out probe for ${ORDINAL_TOKEN} pinned an internal ordinal token the new report`,
  `layout intentionally demoted, so when I ran ${COMMAND_TOKEN} the red reflected the check's own`,
  `staleness rather than a code regression — the check needs rewording, not the code ${DIAG_TAIL}.`,
  "",
  COMMAND_TOKEN,
  "```",
  "not ok 1 - report renders #3 in the header",
  "  expected: #3",
  "```",
].join("\n");

/** Build a FAILED report (committed:false + a red AC) whose What-happened carries `DIAGNOSIS`. */
function failedReportWithDiagnosis(): string {
  return buildDeliveryReport(
    makeInput({
      committed: false,
      acResults: [
        {
          ac: 1,
          pass: false,
          evidence: "$ node --test out-test/x.js → exit 1\nnot ok",
        },
      ],
      diagnosis: [{ ac: 1, text: DIAGNOSIS }],
    }),
  );
}

// ── the HUMAN document is never redacted: the tokens survive VERBATIM ──────────

test("AC5: ordinal + command tokens placed mid-text in the diagnosis appear VERBATIM in the built report", () => {
  const report = failedReportWithDiagnosis();

  // The mid-text tokens the criterion names, verbatim — the human document is never redacted.
  assert.ok(
    report.includes(ORDINAL_TOKEN),
    `the report must carry the ordinal token \`${ORDINAL_TOKEN}\` verbatim (human doc is never redacted)`,
  );
  assert.ok(
    report.includes(COMMAND_TOKEN),
    `the report must carry the command token \`${COMMAND_TOKEN}\` verbatim (human doc is never redacted)`,
  );
  // And the diagnosis lands in full, tail and fenced output included — not a redacted subset.
  assert.ok(
    report.includes(DIAGNOSIS),
    "the report must carry the diagnosis text in full and verbatim",
  );
  assert.ok(
    report.includes(DIAG_TAIL),
    "the distinctive diagnosis tail must survive into the human report",
  );
});

// ── the DERIVED divergence is the redacted artefact ───────────────────────────

test("AC5: stripFailingCheck(extractDiagnosis(report)) carries no AC ordinals, no $-command lines, and no code fences", () => {
  const report = failedReportWithDiagnosis();

  // The report's What-happened diagnosis, routed through the existing redactor — this is exactly
  // the string that primes an attended/rework session.
  const diagnosis = extractDiagnosis(report);
  assert.ok(
    diagnosis && diagnosis.length > 0,
    "extractDiagnosis must recover the What-happened diagnosis from the report",
  );
  // Sanity: the un-redacted diagnosis really does still carry the tokens (else the strip is vacuous).
  assert.ok(
    diagnosis!.includes(ORDINAL_TOKEN) && diagnosis!.includes(COMMAND_TOKEN),
    "fixture guard: the extracted (pre-strip) diagnosis must still contain the redaction tokens",
  );

  const divergence = stripFailingCheck(extractDiagnosis(report) ?? "");

  // No AC ordinals — neither the `AC #3` form nor a bare `#3`.
  assert.ok(
    !/\bAC[\s_]*#?\s*\d+/i.test(divergence),
    `the divergence must carry no AC ordinal — got: ${JSON.stringify(divergence)}`,
  );
  assert.ok(
    !/#\d+\b/.test(divergence),
    `the divergence must carry no bare ordinal token — got: ${JSON.stringify(divergence)}`,
  );
  // No `$ …`-command lines — no line begins with a shell prompt.
  const commandLine = divergence.split(/\r?\n/).find((l) => /^\s*\$\s/.test(l));
  assert.equal(
    commandLine,
    undefined,
    `the divergence must carry no \`$ <cmd>\`-command line — got: ${JSON.stringify(commandLine)}`,
  );
  // No code fences — the fenced runner-output block is gone, delimiters and content.
  assert.ok(
    !/```|~~~/.test(divergence),
    `the divergence must carry no code fence — got: ${JSON.stringify(divergence)}`,
  );
  // The `→ exit N` run-result fragment of the command token is scrubbed too.
  assert.ok(
    !/→\s*exit\s+\d+/i.test(divergence),
    `the divergence must carry no \`→ exit N\` run-result fragment — got: ${JSON.stringify(divergence)}`,
  );
});
