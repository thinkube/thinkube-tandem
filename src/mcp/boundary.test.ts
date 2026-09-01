/**
 * The boundary holds, including against its own future.
 *
 * The interesting case is not that `build` is refused — it is that an
 * action nobody declared is refused too. A tool added later without a
 * decision about who owns it fails closed.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {machineMay} from "./boundary";
import {ACTIONS} from "../surfaces/actions";
import * as fs from "node:fs";
import * as path from "node:path";

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
});

/**
 * Every tool the server offers names an action that exists.
 *
 * This is the check the old two-list boundary could not make, and the bug it
 * would have caught: `look_at` shipped as a tool, was absent from the
 * boundary's list, and was refused on every call it ever received. The tool
 * worked, the refusal worked, and they disagreed about whether the action
 * existed. One declaration cannot disagree with itself, but a tool naming an
 * action nobody declared still can — so the tools are read at source and
 * every action they name must be a row.
 */
test("no tool can name an action that is not declared", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "mcp", "tools.ts"), "utf8");
  const named = [...src.matchAll(/action:\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(named.length > 8, `expected the tools to name actions; found ${named.length}`);
  const undeclared = [...new Set(named)].filter((a) => !(a in ACTIONS));
  assert.deepEqual(undeclared, [], "a tool naming an undeclared action is refused on every call");
});

/**
 * The surface's own gated actions are the list of things a person can
 * press. Every one of them must have been DECIDED about — allowed to a
 * machine, or reserved with a reason — so a new control cannot quietly
 * become reachable by a server that nobody thought about.
 */
