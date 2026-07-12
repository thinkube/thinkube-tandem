// SP-1/1 AC4 — dist/extension.js exists after compile and statically exports activate.
//
// WHY (INVARIANT — must always hold, lives forever): VS Code refuses to load an extension
// whose compiled entry-point does not export a function named `activate`. This probe verifies
// two things atomically: (1) `npm run compile` produced dist/extension.js at all, and
// (2) the compiled text matches /exports\.activate\s*=/, confirming the activation contract
// survives the TEP-1 identity rename. The check is static — the file is read as text, never
// require()'d or executed — because this repo has no Extension-Host harness safe enough to
// run the extension (no @vscode/test-electron; npm test points at a nonexistent file; the
// one vscode stub in the repo lacks APIs that activate() calls, e.g. window.createStatusBarItem).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The compiled test lands at out-test/acceptance/SP-1_1_AC-4.test.js.
// Two levels up from __dirname is the repo root; dist/ lives there.
const REPO_ROOT = path.resolve(__dirname, "../..");
const DIST_ENTRY = path.join(REPO_ROOT, "dist", "extension.js");

// ── existence: compile step produced the entry-point ─────────────────────────
//
// WHY (INVARIANT): if dist/extension.js is missing, VS Code cannot load the extension at
// all — and every other static check in this suite would fail with an unhelpful ENOENT.
// Checking existence first gives a clear diagnosis: "run npm run compile".

test("dist/extension.js exists — compile step must have run (INVARIANT: VS Code cannot load a missing entry-point)", () => {
  assert.ok(
    existsSync(DIST_ENTRY),
    `dist/extension.js not found at ${DIST_ENTRY} — run \`npm run compile\` first`,
  );
});

// ── static activation-contract check: compiled text exports activate ──────────
//
// WHY (INVARIANT): TypeScript compiles `export function activate(...)` to
// `exports.activate = ...` in CommonJS output. The pattern /exports\.activate\s*=/
// matches the assignment, confirming the function survived compilation under the
// new thinkube-tandem identity. Static text match only — no require(), no execution.

test("dist/extension.js text matches /exports\\.activate\\s*=/ — static activation-contract check, no execution (INVARIANT)", () => {
  // Guard: if the file doesn't exist, emit a skip so the error message comes from
  // the existence test above (ENOENT here would obscure the root cause).
  if (!existsSync(DIST_ENTRY)) {
    return;
  }

  const text = readFileSync(DIST_ENTRY, "utf8");

  assert.match(
    text,
    /exports\.activate\s*=/,
    `dist/extension.js must export an activate function ` +
      `(pattern: /exports\\.activate\\s*=/) — ` +
      `VS Code refuses to load an extension whose compiled entry-point lacks this export`,
  );
});
