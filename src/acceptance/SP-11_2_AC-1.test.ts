/**
 * SP-11/2 AC1 — Stalled exits.
 *
 * "For a run that did not commit (closing gate red / requires-attention),
 *  `deliveryExitState` yields exactly the **Attend** and **Re-run** exits (Accept and
 *  Request-changes absent), and `buildDeliveryReport`'s `## Next` section renders exactly
 *  those exit labels from the same set."
 *
 * The post-orchestration surface derives its exits from the run's ACTUAL terminal state
 * (`delivered | stalled`) instead of gluing a fixed pair onto every outcome. A run is
 * *stalled* whenever it did not commit (`committed:false`) OR the closing gate did not pass
 * (`gatePassed:false`); a stalled run offers only **[Attend]** and **[Re-run]** — never an
 * impossible Accept nor a mislabeled Reject.
 *
 * Proven purely against the SP-11/2 SPEC CONTRACT:
 *   - `deliveryExitState({ committed, gatePassed })` — pure, total — returns
 *     `{ state: "stalled", exits: [attend, rerun] }` (in that id order, labels exactly
 *     "Attend" / "Re-run") for EVERY non-(committed ∧ gate-green) input.
 *   - `buildDeliveryReport({ …, exits })` — the ONE exit-state model feeds the report too:
 *     the `## Next` section renders the SAME exit set as numbered bold-label lines
 *     (`1. **<label>** — <hint>`), listing exactly those two labels and no others.
 *
 * The test CONSUMES the exit-state contract — it never re-derives the label strings or the
 * ordering, so any contract drift (a renamed id, a widened exit set, a reordered pair)
 * surfaces here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deliveryExitState,
  buildDeliveryReport,
  type ExitAction,
  type DeliveryReportInput,
} from "../services/orchestratorCore";

// Every run shape that is NOT (committed ∧ gate-green) is stalled — enumerate all three so the
// AC's "committed:false OR gatePassed:false" disjunction is covered exhaustively.
const STALLED_RUNS: { committed: boolean; gatePassed: boolean }[] = [
  { committed: false, gatePassed: true },
  { committed: true, gatePassed: false },
  { committed: false, gatePassed: false },
];

/** The exact stalled exit set the contract pins: ids `attend`, `rerun`, in that order. */
const STALLED_EXITS: ExitAction[] = [
  { id: "attend", label: "Attend" },
  { id: "rerun", label: "Re-run" },
];

/**
 * Slice the report's `## Next` window, using EXACTLY the contract's CANONICAL `## Next` LABEL
 * EXTRACTION snippet — never a bespoke boundary regex. The contract is explicit about why: under
 * the `/m` flag `$` matches end-of-LINE (not end-of-input), and a hand-rolled `(?:\n## |$)` boundary
 * has already caused two false-red rounds. We split on the heading line, then take up to the next
 * `## ` section (or EOF), then pull each numbered bold label — verbatim from the contract.
 */
function nextSection(report: string): string {
  const after = report.split(/^## Next[ \t]*$/m)[1] ?? "";
  return after.split(/\n## /)[0]; // up to the next section or EOF
}
function nextLabels(report: string): string[] {
  const section = nextSection(report);
  return [...section.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map((m) => m[1]);
}

/** A minimal-but-valid stalled `DeliveryReportInput`, parameterized by the forwarded exit set. */
function stalledReportInput(exits: ExitAction[]): DeliveryReportInput {
  return {
    specNumber: "11/2",
    sha: "",
    files: ["src/services/orchestratorCore.ts"],
    units: [{ id: "SP-11_2_SL-1#eu-0", outcome: "failed" }],
    declared: [{ ac: 1, run: "node --test", env: "local" }],
    acResults: [{ ac: 1, pass: false, evidence: "$ node --test → exit 1" }],
    advanced: [],
    attention: ["SP-11_2_SL-1"],
    committed: false,
    exits,
  };
}

test("SP-11/2 AC1 — deliveryExitState is stalled with exactly [Attend, Re-run] for every non-committed / gate-red run", () => {
  for (const run of STALLED_RUNS) {
    const { state, exits } = deliveryExitState(run);

    assert.equal(
      state,
      "stalled",
      `committed=${run.committed} gatePassed=${run.gatePassed} must be stalled`,
    );

    // Exactly the Attend + Re-run pair — ids `attend`, `rerun` in that order, labels verbatim.
    assert.deepEqual(
      exits,
      STALLED_EXITS,
      "a stalled run offers exactly [attend, rerun] with labels Attend / Re-run, in that order",
    );

    // The impossible / retired exits are absent from a stalled run.
    const ids = exits.map((e) => e.id);
    assert.deepEqual(ids, ["attend", "rerun"]);
    assert.ok(!ids.includes("accept"), "Accept is absent from a stalled run");
    assert.ok(
      !ids.includes("request-changes"),
      "Request-changes is absent from a stalled run",
    );
    // "Reject" is retired from the UI vocabulary — no exit label carries the word.
    for (const e of exits) {
      assert.doesNotMatch(e.label, /reject/i, "no exit is labeled Reject");
    }
  }
});

test("SP-11/2 AC1 — buildDeliveryReport's `## Next` renders exactly the stalled exit set's labels (same model)", () => {
  // The report consumes the SAME exit set the state model yields — no second derivation.
  const { exits } = deliveryExitState({ committed: false, gatePassed: false });
  const md = buildDeliveryReport(stalledReportInput(exits));

  const labels = nextLabels(md);
  assert.deepEqual(
    labels,
    ["Attend", "Re-run"],
    "the `## Next` section lists exactly the forwarded exit labels, in order",
  );

  // Belt-and-braces: the retired / impossible vocabulary never appears in the Next section.
  // Same CANONICAL extraction — no bespoke boundary regex.
  const section = nextSection(md);
  assert.doesNotMatch(section, /reject/i, "`## Next` never says Reject");
  assert.doesNotMatch(
    section,
    /accept & merge/i,
    "a stalled `## Next` never offers Accept & merge",
  );
});
