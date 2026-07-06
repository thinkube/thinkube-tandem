/**
 * SP-11/2 AC5 — Skill-primed sessions.
 *
 * "`buildAttendPrompt` and `buildRejectPrompt` return prefills of the form
 *  `/attend <handle-or-spec-id>` followed by the intent-framed divergence, and the returned
 *  string contains no AC ordinals, no failing `run` commands, and no fenced runner output
 *  (redaction preserved)."
 *
 * The attend/rework prefills now invoke the `/attend` skill (TEP-11/SP-1) instead of raw prose:
 *   - `buildAttendPrompt(handle, divergence)` → `"/attend <handle>"` + (divergence ?
 *     `"\n\n" + stripFailingCheck(divergence)` : "");
 *   - `buildRejectPrompt(specId, divergence)` → `"/attend SP-<specId>"` + (divergence ?
 *     `"\n\n" + stripFailingCheck(divergence)` : "").
 *
 * The redaction the pre-`/attend` prompts carried is PRESERVED: the divergence is still routed
 * through `stripFailingCheck`, so the failing AC ordinal, the failing `$ … → exit N` run command,
 * and the fenced runner output never reach the primed session — the fixer is steered by *what
 * behaviour diverged from the intent*, never "make assertion X pass."
 *
 * Proven purely against the SP-11/2 SPEC CONTRACT — only the public builders (and the exported
 * `stripFailingCheck` they compose with) are exercised; no internal implementation is assumed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAttendPrompt,
  buildRejectPrompt,
  stripFailingCheck,
} from "../services/orchestratorCore";

// A divergence deliberately loaded with all three leak channels the redaction must close:
//   • an AC ordinal ("AC #2");
//   • a failing run command shell line ("$ node --test x → exit 1");
//   • a fenced code block wrapping runner output.
// A well-behaved builder passes the PROSE ("The renderer …", "The label …") through while the
// evidence channels are scrubbed.
const DIVERGENCE = [
  "The renderer no longer matches the intent.",
  "AC #2 exercised the failing behaviour:",
  "$ node --test x → exit 1",
  "```",
  "AssertionError: expected the Attend button, got Reject",
  "```",
  "The delivered label was missing from the graph.",
].join("\n");

/**
 * Assert a primed prefill carries none of the three redacted channels anywhere in its text:
 * no AC-ordinal token, no `$ …` run-command line, no ``` / ~~~ code fence.
 */
function assertRedacted(prompt: string): void {
  // No AC ordinals — "AC #2" / "AC 2" / a bare "#2".
  assert.doesNotMatch(prompt, /AC[\s_]*#?\s*\d+/i, "no AC ordinal survives");
  assert.doesNotMatch(prompt, /#\d+\b/, "no bare #N ordinal survives");
  // No failing `run` command lines ($-prefixed shell) and no leftover run-result fragment.
  assert.doesNotMatch(prompt, /^\s*\$\s/m, "no $-command line survives");
  assert.doesNotMatch(
    prompt,
    /node --test x/,
    "the failing run command is gone",
  );
  assert.doesNotMatch(
    prompt,
    /→\s*exit\s+-?\d+/i,
    "no `→ exit N` run-result fragment survives",
  );
  // No fenced runner output — neither the fence delimiters nor the wrapped output.
  assert.doesNotMatch(prompt, /```|~~~/, "no code fence survives");
  assert.doesNotMatch(
    prompt,
    /AssertionError/,
    "the fenced runner output is gone",
  );
}

// Sanity: the fixture really does carry every channel before redaction — otherwise the redaction
// assertions below would pass vacuously.
test("SP-11/2 AC5 — fixture carries an AC ordinal, a $-command line, and a code fence", () => {
  assert.match(DIVERGENCE, /AC[\s_]*#?\s*\d+/i);
  assert.match(DIVERGENCE, /^\s*\$\s/m);
  assert.match(DIVERGENCE, /```/);
});

test("SP-11/2 AC5 — buildAttendPrompt returns `/attend <handle>` and redacts the divergence", () => {
  const handle = "TEP-6_SP-18_SL-1";
  const prompt = buildAttendPrompt(handle, DIVERGENCE);

  // Skill-primed: the prefill invokes the `/attend` skill with the handle verbatim.
  assert.ok(
    prompt.startsWith(`/attend ${handle}`),
    `expected prefill to start "/attend ${handle}", got: ${JSON.stringify(prompt.slice(0, 40))}`,
  );

  // The remainder — everything after the `/attend <handle>` invocation — carries the intent-framed
  // divergence with every evidence channel scrubbed.
  const remainder = prompt.slice(`/attend ${handle}`.length);
  assert.doesNotMatch(
    remainder,
    /^[^\s]/,
    "the handle is followed by a break, not more text",
  );
  assertRedacted(prompt);

  // One source of truth: the remainder is exactly the `stripFailingCheck`-routed divergence
  // (per the contract composition `"/attend <handle>" + "\n\n" + stripFailingCheck(divergence)`),
  // so the redaction is the SAME primitive the rest of the orchestrator uses.
  assert.equal(remainder, `\n\n${stripFailingCheck(DIVERGENCE)}`);

  // The intent prose still travels — the fixer is steered by what diverged, not silenced.
  assert.match(prompt, /renderer no longer matches the intent/);
});

test("SP-11/2 AC5 — buildRejectPrompt returns `/attend SP-<specId>` and redacts the divergence", () => {
  const specId = "6/18";
  const prompt = buildRejectPrompt(specId, DIVERGENCE);

  // Spec-level reject is the same `/attend`-primed shape, addressed at `SP-<specId>`.
  assert.ok(
    prompt.startsWith(`/attend SP-${specId}`),
    `expected prefill to start "/attend SP-${specId}", got: ${JSON.stringify(prompt.slice(0, 40))}`,
  );

  const remainder = prompt.slice(`/attend SP-${specId}`.length);
  assertRedacted(prompt);
  // No `projectThinkingSpaceId` given → the remainder is exactly the routed divergence.
  assert.equal(remainder, `\n\n${stripFailingCheck(DIVERGENCE)}`);

  assert.match(prompt, /renderer no longer matches the intent/);
});

// "Reject" is retired from the UI vocabulary — the reject prefill must not resurrect the word (the
// fenced output in the fixture even contains it, so this also guards the redaction).
test('SP-11/2 AC5 — neither prefill contains the retired word "Reject"', () => {
  assert.doesNotMatch(
    buildAttendPrompt("TEP-6_SP-18_SL-1", DIVERGENCE),
    /reject/i,
  );
  assert.doesNotMatch(buildRejectPrompt("6/18", DIVERGENCE), /reject/i);
});

// No divergence → no trailing blank-line body: the prefill is the bare `/attend` invocation.
test("SP-11/2 AC5 — no divergence yields the bare `/attend` invocation (no dangling body)", () => {
  assert.equal(
    buildAttendPrompt("TEP-6_SP-18_SL-1"),
    "/attend TEP-6_SP-18_SL-1",
  );
  assert.equal(buildRejectPrompt("6/18"), "/attend SP-6/18");
});
