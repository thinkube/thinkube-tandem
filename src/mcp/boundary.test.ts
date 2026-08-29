/**
 * The boundary holds, including against its own future.
 *
 * The interesting case is not that `build` is refused — it is that an
 * action nobody declared is refused too. A tool added later without a
 * decision about who owns it fails closed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MACHINE_MAY, PERSON_ONLY, machineMay } from "./boundary";
import { gatedActions } from "../surfaces/phase";

/**
 * What a machine may do on a person's behalf.
 *
 * Reading and drafting, yes. The two gates — signing and accepting — never,
 * with the reason said. An action nobody declared is refused rather than
 * allowed, because the list of what is dangerous can never be complete,
 * and nothing may be on both lists.
 */
test("the machine boundary allows what is declared and refuses everything else", () => {
  {
  for (const gate of ["build", "accept-delivery", "mint-approval", "keep-draft"]) {
    const v = machineMay(gate);
    assert.equal(v.ok, false, `${gate} must be refused`);
    assert.match((v as { reason: string }).reason, /yours/);
  }
  }
  {
  const v = machineMay("some-tool-added-next-month");
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /not declared/);
  }
  {
  for (const a of ["read-space", "read-run", "save-draft", "reground"])
    assert.equal(machineMay(a).ok, true, `${a} should be allowed`);
  }
  {
  const both = MACHINE_MAY.filter((a) => a in PERSON_ONLY);
  assert.deepEqual(both, [], "an action cannot be the machine's and the person's at once");
  }
});




/**
 * The surface's own gated actions are the list of things a person can
 * press. Every one of them must have been DECIDED about — allowed to a
 * machine, or reserved with a reason — so a new control cannot quietly
 * become reachable by a server that nobody thought about.
 */
test("every action the surface gates has been decided about", () => {
  const undecided = gatedActions().filter(
    (a) => !(MACHINE_MAY as readonly string[]).includes(a) && !(a in PERSON_ONLY),
  );
  assert.deepEqual(
    undecided,
    [],
    `these surface actions have no machine-boundary decision: ${undecided.join(", ")}`,
  );
});
