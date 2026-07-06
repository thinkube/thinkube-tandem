/**
 * SP-11/3 (TEP-11) AC6 — "Diagnosis reaches the test re-author".
 *
 * The fault-test rework seam. `buildTestReworkContext(diagnosis, route)` is the pure gate that
 * decides whether the judge's diagnosis of a broken check reaches the person rewriting it:
 *
 *   - `route === "test"` → the diagnosis text is returned VERBATIM. The tester owns the check and
 *     therefore gets the judged mechanism — including any AC-ordinal token and `$`-prefixed run
 *     command the diagnosis mentions. Redacting a broken check's mechanism from the author who has
 *     to fix it caused two identical false-red rounds on SP-11/2; this seam is the deliberate
 *     exception to the structural redaction boundary.
 *   - any other route (`"code"`, or `undefined`) → `undefined`. Code authors stay fully redacted
 *     (SP-6/9 behaviour, out of scope here), and an unrouted call yields nothing.
 *
 * This exercises ONLY the public interface pinned in the SPEC CONTRACT (`buildTestReworkContext`)
 * — it makes no assumption about the internal implementation, only about the route→return mapping
 * and the verbatim, unredacted passthrough for the `"test"` route.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTestReworkContext } from "../services/orchestratorCore";

// A diagnosis carrying BOTH kinds of token the human document is never redacted of but that the
// structural redaction boundary strips elsewhere: an AC-ordinal reference ("AC #2" / "#2") and a
// `$`-prefixed failing run command. Their verbatim survival under the `"test"` route is the proof
// that the tester gets the judged mechanism unredacted.
const AC_ORDINAL_TOKEN = "AC #2";
const DOLLAR_COMMAND =
  "$ node --test out-test/acceptance/SP-11_3_AC-2.test.js → exit 1";
const DIAGNOSIS =
  `The held-out probe for ${AC_ORDINAL_TOKEN} armed its fixture against a seam the delivered ` +
  `behaviour renamed, so \`${DOLLAR_COMMAND}\` fails on a stale precondition rather than a real ` +
  `regression — the check itself needs rewording, not the code «diag-tail-Ω-9f3c42».`;

// ── route === "test" → the diagnosis VERBATIM, tokens and all ──────────────────

test('AC6: buildTestReworkContext(diagnosis, "test") returns the diagnosis string VERBATIM', () => {
  const out = buildTestReworkContext(DIAGNOSIS, "test");
  // Strict identity of the returned string — not a rewrapped, summarized, or clipped variant.
  assert.equal(out, DIAGNOSIS);
});

test('AC6: the "test"-route result is UNREDACTED — the AC-ordinal token survives verbatim', () => {
  const out = buildTestReworkContext(DIAGNOSIS, "test");
  assert.ok(
    typeof out === "string" && out.includes(AC_ORDINAL_TOKEN),
    `the AC-ordinal token ${JSON.stringify(AC_ORDINAL_TOKEN)} must survive into the test re-author's context — got: ${JSON.stringify(out)}`,
  );
});

test('AC6: the "test"-route result is UNREDACTED — the $-prefixed run command survives verbatim', () => {
  const out = buildTestReworkContext(DIAGNOSIS, "test");
  assert.ok(
    typeof out === "string" && out.includes(DOLLAR_COMMAND),
    `the \`$\`-command token must survive into the test re-author's context — got: ${JSON.stringify(out)}`,
  );
});

// ── any other route → undefined (code authors stay fully redacted; unrouted yields nothing) ──

test('AC6: buildTestReworkContext(diagnosis, "code") returns undefined (code authors stay redacted)', () => {
  assert.equal(buildTestReworkContext(DIAGNOSIS, "code"), undefined);
});

test("AC6: buildTestReworkContext(diagnosis, undefined) returns undefined (an unrouted call yields nothing)", () => {
  assert.equal(buildTestReworkContext(DIAGNOSIS, undefined), undefined);
});
