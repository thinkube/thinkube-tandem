/**
 * SP-6/16 (TEP-6) AC6 — a held-out `role: test` worker's `Grep` is contained to its cwd snapshot.
 *
 * The defect this closes: the blanket `Grep` deny on `role: test` workers exists only to stop a
 * pathless / out-of-tree search from reaching the SIBLING code worktree (`…-worktrees/TEP-6_SP-{n}`)
 * where the graded implementation lives. SP-6/16 un-denies `Grep` and instead SCOPES it — a pure,
 * lexical containment guard that permits an in-cwd search but rejects one that escapes cwd. This
 * restores fair in-tree search while preserving the tester-snapshot independence model: a Grep that
 * cannot leave the base-commit snapshot cannot reach the in-progress code.
 *
 * Verified PURELY against the SP-6/16 SPEC CONTRACT — the exported, fs-free, vscode-free
 * `grepWithinCwd(toolName, toolInput, cwd)` in `src/services/orchestratorCore.ts`. Its rule:
 *   - toolName !== "Grep"                                → { allow: true }
 *   - Grep with no `path` (i.e. searches cwd)            → { allow: true }
 *   - Grep whose `path` resolves within cwd             → { allow: true }
 *   - Grep whose `path` is absolute OR `..`-escapes cwd  → { allow: false, reason }
 * The check is PURELY LEXICAL (path.resolve/relative against cwd) — no realpath / fs. This exercises
 * ONLY the public helper and makes NO assumption about the internal implementation beyond the
 * `{ allow: true } | { allow: false; reason }` contract shape. Assertions on `reason` are presence /
 * non-empty only (never exact-glyph), so the refusal wording can evolve.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { grepWithinCwd } from "../services/orchestratorCore";

// An absolute worker cwd — the tester snapshot worktree. Built with path.resolve so the fixture is
// itself an absolute, normalized path (the same shape the live cwd has). Its sibling — the code
// worktree the containment must fence out — sits one level up under a peer name.
const CWD = path.resolve(
  "/repo/thinkube/extensions/x-worktrees/TEP-6_SP-16-test",
);
const SIBLING_CODE_WORKTREE = path.resolve(
  "/repo/thinkube/extensions/x-worktrees/TEP-6_SP-16",
);

// Narrow the union to its deny arm so `.reason` is type-safe and every deny case asserts a
// non-empty, string reason (the contract's `{ allow: false; reason: string }`).
function assertDenied(
  result: { allow: true } | { allow: false; reason: string },
  message: string,
): asserts result is { allow: false; reason: string } {
  assert.equal(result.allow, false, message);
  const denied = result as { allow: false; reason: string };
  assert.equal(
    typeof denied.reason,
    "string",
    "a denial must carry a string `reason`",
  );
  assert.ok(
    denied.reason.trim().length > 0,
    "the denial `reason` must be non-empty (it explains the containment breach)",
  );
}

// ── ALLOW: any non-Grep tool is untouched by the containment guard ──

test("AC6: a non-Grep tool is allowed regardless of its input (guard is Grep-scoped)", () => {
  // Even an absolute-path input on a non-Grep tool is allowed — the guard only fences `Grep`.
  for (const toolName of ["Read", "Edit", "Write", "Glob", "Bash", "Task"]) {
    assert.deepEqual(
      grepWithinCwd(toolName, { path: SIBLING_CODE_WORKTREE }, CWD),
      { allow: true },
      `${toolName} is not a Grep — the containment guard must allow it`,
    );
  }
});

test("AC6: a non-Grep tool is allowed even when its input is not an object", () => {
  assert.deepEqual(
    grepWithinCwd("Read", undefined, CWD),
    { allow: true },
    "a non-Grep tool with no structured input is allowed",
  );
});

// ── ALLOW: a Grep that stays within cwd ──

test("AC6: a Grep with NO path is allowed (it searches cwd)", () => {
  assert.deepEqual(
    grepWithinCwd("Grep", { pattern: "TODO" }, CWD),
    { allow: true },
    "a pathless Grep searches cwd itself and must be allowed",
  );
});

test("AC6: a Grep whose input omits `path` entirely (empty object) is allowed", () => {
  assert.deepEqual(
    grepWithinCwd("Grep", {}, CWD),
    { allow: true },
    "an absent `path` = search cwd = allowed",
  );
});

test("AC6: a Grep whose relative path resolves WITHIN cwd is allowed", () => {
  for (const p of [
    "src",
    "src/services",
    "src/services/orchestratorCore.ts",
    "./src/services",
    "src/./services",
  ]) {
    assert.deepEqual(
      grepWithinCwd("Grep", { path: p }, CWD),
      { allow: true },
      `an in-cwd relative path (${p}) must be allowed`,
    );
  }
});

test("AC6: a Grep on cwd itself ('.') is allowed", () => {
  assert.deepEqual(
    grepWithinCwd("Grep", { path: "." }, CWD),
    { allow: true },
    "'.' resolves to cwd and is contained — allowed",
  );
});

test("AC6: a `..`-then-back-in path that still lands inside cwd is allowed", () => {
  // Resolves back within cwd (leaves then re-enters the SAME snapshot), so it is contained.
  const p = "src/../src/services/orchestratorCore.ts";
  assert.deepEqual(
    grepWithinCwd("Grep", { path: p }, CWD),
    { allow: true },
    "a path that dips out with `..` but resolves back inside cwd is still contained",
  );
});

// ── DENY: a Grep whose path escapes cwd — absolute, or `..`-escaping ──

test("AC6: a Grep with an ABSOLUTE path is denied (even one nested inside cwd)", () => {
  // Absolute path OUTSIDE cwd — the classic escape into another tree.
  assertDenied(
    grepWithinCwd("Grep", { path: "/etc" }, CWD),
    "an absolute path outside cwd must be denied",
  );

  // Absolute path pointing AT the sibling code worktree — exactly the escape the guard exists for.
  assertDenied(
    grepWithinCwd("Grep", { path: SIBLING_CODE_WORKTREE }, CWD),
    "an absolute path into the sibling code worktree must be denied",
  );

  // Absolute path that happens to be nested inside cwd is STILL denied — the contract denies on
  // `path` being absolute, per "absolute OR `..`-escapes".
  assertDenied(
    grepWithinCwd("Grep", { path: path.join(CWD, "src", "services") }, CWD),
    "the contract denies an absolute `path` (absolute OR `..`-escaping)",
  );
});

test("AC6: a Grep whose `..`-escaping path reaches the sibling code worktree is denied", () => {
  // ../TEP-6_SP-16/... climbs out of the tester snapshot into the sibling code worktree where the
  // graded implementation lives — the precise escape the containment guard must block.
  assertDenied(
    grepWithinCwd(
      "Grep",
      { path: "../TEP-6_SP-16/src/services/orchestratorCore.ts" },
      CWD,
    ),
    "a `..`-escape into the sibling code worktree must be denied",
  );
});

test("AC6: a Grep whose `..`-escaping path climbs above cwd is denied", () => {
  for (const p of ["..", "../..", "../sibling", "src/../../elsewhere"]) {
    assertDenied(
      grepWithinCwd("Grep", { path: p }, CWD),
      `a path that escapes cwd via '..' (${p}) must be denied`,
    );
  }
});

// ── The deny/allow decision is driven by the RESOLVED path against cwd, not by the tool name alone ──

test("AC6: the SAME escaping path is denied for Grep but allowed for a non-Grep tool", () => {
  const escaping = { path: "../TEP-6_SP-16/src" };

  assertDenied(
    grepWithinCwd("Grep", escaping, CWD),
    "Grep with an escaping path is contained (denied)",
  );

  assert.deepEqual(
    grepWithinCwd("Read", escaping, CWD),
    { allow: true },
    "the same escaping input on a non-Grep tool is not the guard's concern (allowed)",
  );
});
