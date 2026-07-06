/**
 * SP-6/16 (TEP-6) AC5 — `Grep` is no longer denied to a held-out `role: test` worker, while the
 * other four denied tools remain denied.
 *
 * The defect this closes: the blanket `role: test` denylist forbade `Grep` wholesale, so a test
 * worker that (per the tooling's own advice) reached for an in-tree search hit a hard wall with no
 * fallback. Part B of the fix un-denies `Grep` and instead SCOPES it to the worker's cwd snapshot
 * (a separate containment helper, `grepWithinCwd`, covered elsewhere). This AC pins ONLY the
 * denylist change: `Grep` leaves the `test` denylist; `Bash`, `WebFetch`, `WebSearch`, and `Task`
 * stay on it — `Bash` in particular, because an arbitrary shell command cannot be lexically
 * contained. And a `code` unit keeps its empty denylist (unrestricted `Grep`, since it already has
 * `Bash`).
 *
 * Verified PURELY against the SP-6/16 SPEC CONTRACT — the exported, vscode-free
 * `disallowedToolsForRole(role?)` in `src/services/orchestratorCore.ts`:
 *   - role === "test"  → ["Bash", "WebFetch", "WebSearch", "Task"]  (Grep removed; the other four remain)
 *   - otherwise        → []
 *
 * The test CONSUMES the public `disallowedToolsForRole` interface only — it makes no assumption
 * about internal implementation, ordering aside from set membership.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { disallowedToolsForRole } from "../services/orchestratorCore";

// ── AC5 core: `Grep` is un-denied for a test worker; the other four remain denied ──

test("AC5: disallowedToolsForRole('test') EXCLUDES Grep", () => {
  const denied = disallowedToolsForRole("test");
  assert.ok(
    !denied.includes("Grep"),
    "Grep must no longer be denied to a role:test worker",
  );
});

test("AC5: disallowedToolsForRole('test') still INCLUDES Bash, WebFetch, WebSearch, and Task", () => {
  const denied = disallowedToolsForRole("test");
  for (const tool of ["Bash", "WebFetch", "WebSearch", "Task"]) {
    assert.ok(
      denied.includes(tool),
      `${tool} must remain on the role:test denylist`,
    );
  }
});

// Bash in particular stays denied — an arbitrary shell command is not lexically containable, so it
// is the one tool that cannot be un-denied-and-scoped the way Grep is.
test("AC5: Bash stays denied for a test worker (the un-containable roam vector)", () => {
  assert.ok(
    disallowedToolsForRole("test").includes("Bash"),
    "Bash must remain denied to a role:test worker",
  );
});

// The exact denylist per the contract — set-equality pins that ONLY Grep left and nothing else
// changed (no tool silently added or dropped alongside).
test("AC5: disallowedToolsForRole('test') is exactly {Bash, WebFetch, WebSearch, Task}", () => {
  const denied = disallowedToolsForRole("test");
  assert.deepEqual(
    [...denied].sort(),
    ["Bash", "Task", "WebFetch", "WebSearch"],
    "the role:test denylist must be exactly Bash/WebFetch/WebSearch/Task (Grep removed)",
  );
});

// ── AC5 code-unit half: a code worker denies nothing (keeps unrestricted Grep) ──

test("AC5: disallowedToolsForRole('code') is the empty array", () => {
  assert.deepEqual(
    disallowedToolsForRole("code"),
    [],
    "a role:code worker denies no tools",
  );
});

// The defaulted role (undefined ⇒ code) also denies nothing — backward-compatible with the
// contract's `otherwise → []` branch.
test("AC5: disallowedToolsForRole() with no role defaults to the empty denylist", () => {
  assert.deepEqual(
    disallowedToolsForRole(),
    [],
    "an absent role defaults to code — no tools denied",
  );
});
