/**
 * SP-11/2 AC2 — Delivered exits.
 *
 * "For a committed, gate-green run, `deliveryExitState` yields exactly **Accept & merge**
 *  and **Request changes**, `## Next` renders them, and no exit label in either state
 *  contains the word 'Reject'."
 *
 * The post-orchestration surface derives its exits from the run's ACTUAL terminal state
 * (`delivered | stalled`) instead of gluing a fixed Accept/Reject pair onto every outcome. A
 * run is *delivered* ⇔ it committed AND the closing gate passed (`committed && gatePassed`);
 * a delivered run offers exactly **[Accept & merge]** and **[Request changes]** — never a
 * mislabeled Reject. "Reject" is retired from the UI vocabulary in BOTH states.
 *
 * Proven purely against the SP-11/2 SPEC CONTRACT:
 *   - `deliveryExitState({ committed: true, gatePassed: true })` — pure, total — returns
 *     `{ state: "delivered", exits: [accept, request-changes] }` (in that id order, labels
 *     exactly "Accept & merge" / "Request changes").
 *   - `buildDeliveryReport({ …, exits })` — the ONE exit-state model feeds the report too:
 *     the `## Next` section renders the SAME exit set as numbered bold-label lines
 *     (`1. **<label>** — <hint>`), listing exactly those two labels and no others.
 *   - Neither the delivered NOR the stalled exit set carries a label matching /reject/i.
 *
 * The `## Next` labels are read out of the report with EXACTLY the contract's canonical
 * extraction snippet (below) — never a homegrown section-boundary regex. `$` under the /m flag
 * matches end-of-LINE, not end-of-input, and a bespoke `(?:\n## |$)` boundary has already caused
 * two false-red rounds; the canonical `split` avoids it. The test otherwise CONSUMES the exit-state
 * contract — it never re-derives the label strings or the ordering, so any contract drift (a renamed
 * id, a widened exit set, a reordered pair, a resurrected "Reject") surfaces here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deliveryExitState,
  buildDeliveryReport,
  type ExitAction,
  type DeliveryReportInput,
} from "../services/orchestratorCore";

/** The exact delivered exit set the contract pins: ids `accept`, `request-changes`, in that order. */
const DELIVERED_EXITS: ExitAction[] = [
  { id: "accept", label: "Accept & merge" },
  { id: "request-changes", label: "Request changes" },
];

/**
 * The CANONICAL `## Next` LABEL EXTRACTION snippet, verbatim from the SPEC CONTRACT. Both the
 * implementation's output and this test read the section this exact way — no invented regex for the
 * section boundary. Note `/^## Next[ \t]*$/m` (end-of-LINE), then `split(/\n## /)` for the section
 * window (up to the next heading or EOF), then the numbered bold-label match.
 */
function nextLabels(report: string): string[] {
  const after = report.split(/^## Next[ \t]*$/m)[1] ?? "";
  const section = after.split(/\n## /)[0]; // up to the next section or EOF
  const labels = [...section.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map(
    (m) => m[1],
  );
  return labels;
}

/**
 * The `## Next` section body (up to the next heading / EOF), sliced with the SAME canonical
 * boundary as {@link nextLabels} — used for the belt-and-braces "never says Reject" scan.
 */
function nextSection(report: string): string {
  const after = report.split(/^## Next[ \t]*$/m)[1] ?? "";
  return after.split(/\n## /)[0];
}

/** A minimal-but-valid delivered `DeliveryReportInput`, parameterized by the forwarded exit set. */
function deliveredReportInput(exits: ExitAction[]): DeliveryReportInput {
  return {
    specNumber: "11/2",
    sha: "abc1234",
    files: ["src/services/orchestratorCore.ts"],
    units: [{ id: "SP-11_2_SL-1#eu-0", outcome: "success" }],
    declared: [{ ac: 1, run: "node --test", env: "local" }],
    acResults: [{ ac: 1, pass: true, evidence: "$ node --test → exit 0" }],
    advanced: ["SP-11_2_SL-1"],
    attention: [],
    committed: true,
    exits,
  };
}

test("SP-11/2 AC2 — deliveryExitState is delivered with exactly [Accept & merge, Request changes] for a committed, gate-green run", () => {
  const { state, exits } = deliveryExitState({
    committed: true,
    gatePassed: true,
  });

  assert.equal(state, "delivered", "committed && gatePassed must be delivered");

  // Exactly the Accept + Request-changes pair — ids `accept`, `request-changes` in that order,
  // labels verbatim from the contract.
  assert.deepEqual(
    exits,
    DELIVERED_EXITS,
    "a delivered run offers exactly [accept, request-changes] with labels Accept & merge / Request changes, in that order",
  );

  // The stalled-only exits are absent from a delivered run.
  const ids = exits.map((e) => e.id);
  assert.deepEqual(ids, ["accept", "request-changes"]);
  assert.ok(!ids.includes("attend"), "Attend is absent from a delivered run");
  assert.ok(!ids.includes("rerun"), "Re-run is absent from a delivered run");
});

test("SP-11/2 AC2 — buildDeliveryReport's `## Next` renders exactly the delivered exit set's labels (same model)", () => {
  // The report consumes the SAME exit set the state model yields — no second derivation.
  const { exits } = deliveryExitState({ committed: true, gatePassed: true });
  const md = buildDeliveryReport(deliveredReportInput(exits));

  const labels = nextLabels(md);
  assert.deepEqual(
    labels,
    ["Accept & merge", "Request changes"],
    "the `## Next` section lists exactly the forwarded exit labels, in order",
  );

  // Belt-and-braces: the retired "Reject" vocabulary never appears in the Next section.
  assert.doesNotMatch(
    nextSection(md),
    /reject/i,
    "a delivered `## Next` never says Reject",
  );
});

test("SP-11/2 AC2 — no exit label in EITHER state contains the word 'Reject'", () => {
  // "Reject" is retired from UI vocabulary across BOTH terminal states — assert over the exit
  // sets the model itself yields, so a resurrected label surfaces here regardless of state.
  const delivered = deliveryExitState({ committed: true, gatePassed: true });
  const stalled = deliveryExitState({ committed: false, gatePassed: false });

  assert.equal(delivered.state, "delivered");
  assert.equal(stalled.state, "stalled");

  for (const { state, exits } of [delivered, stalled]) {
    for (const e of exits) {
      assert.doesNotMatch(
        e.label,
        /reject/i,
        `no exit in the ${state} state may be labeled Reject (got "${e.label}")`,
      );
    }
  }
});
