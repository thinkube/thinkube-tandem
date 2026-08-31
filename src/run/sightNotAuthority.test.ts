/**
 * At the gate an author may read the check that failed it, never write it.
 *
 * Blinding a coder is what makes a green mean something while code is being
 * written: the check states the criterion independently, and code written to
 * the check proves nothing. That argument runs out at the repair rung. The
 * check has already run, its verdict is the thing in dispute, and the very
 * next rung hands the same file to the closer with full sight. Withholding
 * it for one round only makes the author reason about evidence it cannot
 * see, and pays a round for it.
 *
 * Authority is the half that must not move. A coder may not write a check at
 * any rung, whatever its footprint says — that rule is unconditional and is
 * what keeps the exam out of the examinee's hands.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusedToolUse, toolsRefusedTo } from "./toolsAllowed";

const CHECK = "src/surfaces/pages_AC-1.test.ts";
const CODE = "webview/map/src/App.tsx";

test("a coder writing a check is refused, blinded or not", () => {
  for (const blind of [true, false, undefined])
    assert.match(
      refusedToolUse({ role: "code", ...(blind === undefined ? {} : { blind }) }, "Write", CHECK) ?? "",
      /never writes a test or probe file/,
      `authority must not depend on sight (blind: ${String(blind)})`,
    );
});

test("an author with sight may read the check that failed it", () => {
  assert.equal(refusedToolUse({ role: "code" }, "Read", CHECK), undefined, "the verdict in dispute is readable");
  assert.match(
    refusedToolUse({ role: "code", blind: true }, "Read", CHECK) ?? "",
    /held out/,
    "while the code is being written, it is not",
  );
});

test("sight does not hand over the checks' tree", () => {
  assert.equal(refusedToolUse({ role: "code" }, "Edit", CHECK) !== undefined, true);
  assert.equal(refusedToolUse({ role: "code" }, "NotebookEdit", CHECK) !== undefined, true);
  assert.equal(refusedToolUse({ role: "code" }, "Write", CODE), undefined, "its own code stays its own");
});

/**
 * With sight comes a shell, and a shell can write a file the Write refusal
 * would have stopped. The footprint guard is what catches that, so the gate's
 * author keeps its fence — the door is what stops the fence costing a round.
 */
test("an unblinded coder has a shell, which is why the fence stays", () => {
  assert.ok(!toolsRefusedTo({ role: "code" }).includes("Bash"), "sight brings a shell with it");
  assert.ok(toolsRefusedTo({ role: "code", blind: true }).includes("Bash"), "blinding withholds one");
});

