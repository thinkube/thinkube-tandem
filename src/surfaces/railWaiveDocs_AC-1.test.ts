/**
 * The not-needed reason and its control, as a static render of the real
 * surface shows them.
 *
 * The failure this guards: a control table that lists only buttons cannot
 * say whether the box a person types the reason into is there at all, and
 * a control drawn on in a phase the host refuses is a button that answers
 * "not now" — or worse, records a waiver against work nobody can read.
 *
 * The surface is TSX built by vite, not by the extension's tsconfig, so
 * this drives the harness bundle: it renders <App/> for every phase with
 * `allowedNow(phase)` from the host's own table, which is the same rule
 * the host decides by. Reading Rail.tsx as text instead would agree with
 * a stub that spells the same attribute names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { allowedNow, Phase } from "./phase";
import { renderedTable } from "./railHarness.test";

const repo = path.resolve(__dirname, "..", "..");
const bundle = path.join(repo, "out-test", "harness", "buttons.cjs");

/**
 * The control table, per phase and tab. Built once: the harness is a vite
 * SSR build, which costs seconds, and every drive below reads the same
 * table.
 */
function controlTable(): Record<string, Record<string, string[]>> {
  return JSON.parse(renderedTable(repo, bundle)) as Record<string, Record<string, string[]>>;
}

const table = controlTable();

/** Every control row for a phase, across all tabs. */
function rowsFor(phase: string): string[] {
  return Object.values(table[phase] ?? {}).flat();
}

// INVARIANT: in a phase where the host acts on waive-docs, the render
// carries BOTH halves of the gesture — the reason box and the button —
// and both are on. A button with no box is half a control.
test("the cut-review state renders a reason input and a waive-docs control, both on where the host allows it", () => {
  const allowing = (["drafting", "read", "understood", "signed", "running", "delivered"] as Phase[])
    .filter((p) => allowedNow(p).includes("waive-docs"))
    .filter((p) => table[p]);
  assert.notDeepEqual(allowing, [], "no rendered phase allows waive-docs");

  for (const phase of allowing) {
    const rows = rowsFor(phase);
    assert.ok(
      rows.some((r) => /^on\s+.*\bdocs-waiver-reason\b/.test(r)),
      `${phase}: no enabled reason input in the render (rows: ${rows.join(" | ")})`,
    );
    assert.ok(
      rows.some((r) => /^on\s+.*\bwaive-docs\b/.test(r)),
      `${phase}: no enabled waive-docs control in the render (rows: ${rows.join(" | ")})`,
    );
  }
});

// INVARIANT: in every phase the host refuses waive-docs, the control is
// drawn OFF. The surface and the host must not disagree about whether a
// gesture can be made.
test("the waive-docs control and its reason box are off in the phases the host refuses them in", () => {
  const refusing = (["drafting", "read", "understood", "signed", "running", "delivered"] as Phase[])
    .filter((p) => !allowedNow(p).includes("waive-docs"))
    .filter((p) => table[p]);
  assert.notDeepEqual(refusing, [], "every rendered phase allows waive-docs — nothing is being refused");

  for (const phase of refusing) {
    for (const row of rowsFor(phase)) {
      if (/\bwaive-docs\b|\bdocs-waiver-reason\b/.test(row)) {
        assert.match(row, /^off\s/, `${phase}: the host refuses waive-docs but the surface draws "${row}"`);
      }
    }
  }
});
