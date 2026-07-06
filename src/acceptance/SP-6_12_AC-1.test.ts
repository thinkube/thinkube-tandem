/**
 * SP-6/12 (TEP-6) AC1 — a code-author worker's prompt carries the repo's declared
 * self-verification command.
 *
 * The defect this closes: a code-author, after editing its files, tries to self-verify by
 * running tests but doesn't know the repo's canonical build-and-test command (it lives only in
 * the closing-gate recipe workers never see), so it improvises into shared build config and
 * hits the footprint guard. The fix surfaces the repo-declared command in the ONE artifact the
 * worker reads — its prompt — under a distinct, checkable block marker.
 *
 * This AC pins the observable render contract of `buildWorkerPrompt` (SPEC CONTRACT): for a
 * CODE unit, when `context.selfVerifyCommand` is set, the rendered prompt carries a VERIFICATION
 * BLOCK whose header line contains the exact token `SELF-VERIFY`, and the block reproduces the
 * command VERBATIM (trimmed). The command is passed IN via `context` — the pure path — so this
 * exercises ONLY the public `buildWorkerPrompt` interface and makes NO assumption about how the
 * command is sourced from `conventions.json` (that seam is the resolver's own coverage).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkerPrompt,
  type SchedUnit,
} from "../services/orchestratorCore";

// A minimal CODE unit (role omitted ⇒ `code` by the contract's default). Render rules for the
// verification block + prohibitions apply to code units only, so this is the subject under test.
const codeUnit = (over: Partial<SchedUnit> = {}): SchedUnit => ({
  id: "SP-6_SL-1#eu-0",
  slice: "SP-6_SL-1",
  footprint: ["src/foo.ts"],
  requires: [],
  shape: "fan-out",
  note: "implement foo end to end",
  ...over,
});

// The canonical, non-mutating build-and-test invocation a code-author runs (the shape the repo
// declares: compile the excluded test tree via tsconfig.test.json, then run it out of out-test/).
const SELF_VERIFY_CMD =
  "npx tsc -p tsconfig.test.json && node --test out-test/services/orchestratorCore.test.js";

// ── AC1 core: the command renders VERBATIM under a SELF-VERIFY block marker ───

test("AC1: a code unit's prompt renders the self-verify command VERBATIM under a SELF-VERIFY block marker", () => {
  const p = buildWorkerPrompt(codeUnit(), "6", {
    selfVerifyCommand: SELF_VERIFY_CMD,
  });

  // 1) The distinct, checkable block marker is present — its exact token is `SELF-VERIFY`.
  assert.ok(
    p.includes("SELF-VERIFY"),
    "the verification block header must contain the exact token 'SELF-VERIFY'",
  );

  // 2) The declared command appears VERBATIM (exact substring — not re-worded or re-escaped).
  assert.ok(
    p.includes(SELF_VERIFY_CMD),
    `the prompt must reproduce the self-verify command verbatim (looking for: ${SELF_VERIFY_CMD})`,
  );

  // 3) The command sits UNDER the block marker — the marker introduces the command, so the token
  //    appears at or before the command in the rendered text (it is the block's header, not a
  //    coincidental mention that trails the command).
  assert.ok(
    p.indexOf("SELF-VERIFY") <= p.indexOf(SELF_VERIFY_CMD),
    "the SELF-VERIFY marker must head the block that contains the command",
  );
});

// The default role is `code` (role omitted). Passing role: "code" explicitly must render the
// same block — the branch keys on `(role ?? "code") !== "test"`, so both spellings are code.
test("AC1: an explicit role:'code' unit renders the same SELF-VERIFY block + verbatim command", () => {
  const p = buildWorkerPrompt(codeUnit({ role: "code" }), "6", {
    selfVerifyCommand: SELF_VERIFY_CMD,
  });
  assert.ok(
    p.includes("SELF-VERIFY"),
    "explicit code role still gets the block",
  );
  assert.ok(
    p.includes(SELF_VERIFY_CMD),
    "explicit code role still gets the verbatim command",
  );
});

// The command is reproduced TRIMMED-but-otherwise-verbatim: surrounding whitespace on the passed
// value is stripped, while the command's own internal text (flags, `&&`, paths) is untouched.
test("AC1: the rendered command is the TRIMMED value, byte-for-byte otherwise", () => {
  const p = buildWorkerPrompt(codeUnit(), "6", {
    selfVerifyCommand: `\n   ${SELF_VERIFY_CMD}   \n`,
  });
  assert.ok(
    p.includes(SELF_VERIFY_CMD),
    "the trimmed command must appear verbatim in the block",
  );
  // The un-trimmed padding must NOT leak into the prompt as a dangling blank-padded line.
  assert.ok(
    !p.includes(`   ${SELF_VERIFY_CMD}   `),
    "leading/trailing whitespace on the passed command must be trimmed off",
  );
});

// A distinct command string proves the render echoes the SUPPLIED value (not a hardcoded token):
// change the command, the new command appears verbatim and the old one does not.
test("AC1: the block echoes the supplied command, not a hardcoded string", () => {
  const other = "make verify-tests";
  const p = buildWorkerPrompt(codeUnit(), "6", { selfVerifyCommand: other });
  assert.ok(
    p.includes("SELF-VERIFY"),
    "the marker renders for any supplied command",
  );
  assert.ok(
    p.includes(other),
    "the supplied command is echoed verbatim under the block",
  );
  assert.ok(
    !p.includes(SELF_VERIFY_CMD),
    "an unrelated command is not present — the render is not hardcoded",
  );
});
