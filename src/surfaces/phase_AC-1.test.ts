/**
 * The phase table and the surface's shaping list must name the same
 * actions, and they must be compared by RUNNING both sides.
 *
 * The failure this guards: an action present on one side only. Absent
 * from the table, `refusedNow` refuses it in no phase and `allowedNow`
 * never lists it, so the host always acts on it and its control is dead
 * in every phase. Absent from the surface, the table governs a gesture
 * nothing can send. The two halves fail in opposite directions and
 * neither says anything.
 *
 * The surface is TSX under its own rootDir, which the extension's build
 * cannot import. Its shaping set is carried out through the harness
 * bundle instead — read from the running module, not recovered with a
 * regex over its source text, which would agree just as readily with a
 * stub that spells the same names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { allowedNow, gatedActions, refusedNow, Phase } from "./phase";
import { renderedTable } from "./railHarness.test";

const PHASES: readonly Phase[] = [
  "drafting",
  "read",
  "understood",
  "signed",
  "running",
  "delivered",
];

const repo = path.resolve(__dirname, "..", "..");
const bundle = path.join(repo, "out-test", "harness", "buttons.cjs");

function shapingActions(): string[] {
  const table = JSON.parse(renderedTable(repo, bundle)) as Record<string, unknown>;
  const list = table["shaping:actions"];
  assert.ok(Array.isArray(list), "the surface no longer reports which actions are shaping");
  return list as string[];
}

const shapingList = shapingActions();

// The phase table is host code with no TSX and no vscode import, so it is
// driven HERE, in this process, and not only inside the harness child.
// Read through the child alone, every line it executes is attributed to
// that process and this drive reaches its subject on paper only.
test("the phase table answers for every action it governs, in this process", () => {
  const gated = gatedActions();
  assert.notDeepEqual(gated, [], "no action is governed by any phase");
  for (const action of gated) {
    const phases = PHASES.filter((p) => allowedNow(p).includes(action));
    assert.notDeepEqual(phases, [], `${action} is governed but allowed in no phase`);
    for (const phase of PHASES) {
      const why = refusedNow(action, phase);
      if (phases.includes(phase)) assert.equal(why, undefined, `${phase} both allows and refuses ${action}`);
      else assert.match(why ?? "", /\S/, `${phase} refuses ${action} with no reason`);
    }
  }
});

// INVARIANT: the two lists are set-equal. Stated in both directions so a
// failure says WHICH side is missing the name, not merely that they differ.
test("every action the surface can send is governed by a phase, and every governed action can be sent", () => {
  const shaping = [...shapingList].sort();
  const gated = [...gatedActions()].sort();
  assert.deepEqual(
    shaping.filter((a) => !gated.includes(a)),
    [],
    "the surface can send these, and no phase governs them",
  );
  assert.deepEqual(
    gated.filter((a) => !shaping.includes(a)),
    [],
    "the phase table governs these, and the surface never sends them",
  );
});

// INVARIANT: the gesture this work adds is on BOTH sides. The set-equality
// above holds vacuously if waive-docs is missing from each, so name it.
test("waive-docs is both a shaping action of the surface and an action the phase table governs", () => {
  assert.ok(shapingList.includes("waive-docs"), "the surface cannot send waive-docs");
  assert.ok(gatedActions().includes("waive-docs"), "no phase governs waive-docs");
});
