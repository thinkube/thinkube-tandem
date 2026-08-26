/**
 * What the not-needed reason box actually SENDS.
 *
 * The failure this guards: a rule kept inside an onClick is a rule nothing
 * can ask about — a static render throws every handler away, so "a blank
 * reason posts nothing" would only ever be checked by a person typing into
 * the running product. A waiver recorded for an empty reason is a cut that
 * skips documentation for no stated reason at all, which is exactly what
 * the sign gate's docs duty exists to prevent.
 *
 * The rule lives in submitDocsWaiver, beside the control, as a plain
 * function of what was typed; this drives it through the harness bundle so
 * the real surface module runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { renderedTable } from "./railHarness.test";

const repo = path.resolve(__dirname, "..", "..");
const bundle = path.join(repo, "out-test", "harness", "buttons.cjs");

type Posted = { action: "waive-docs"; text: string } | null;

// Read on FIRST USE inside a test, never at module load: a harness that
// cannot be built would otherwise throw before any test body runs, and a
// file whose drives never run reaches its subject on paper only.
let sentCache: Record<string, Posted> | undefined;
function gestures(): Record<string, Posted> {
  if (sentCache) return sentCache;
  const table = JSON.parse(renderedTable(repo, bundle)) as Record<string, unknown>;
  const g = table["gestures:waive-docs"];
  assert.ok(g, "the harness no longer records what the reason box sends");
  sentCache = g as Record<string, Posted>;
  return sentCache;
}

// INVARIANT: a real reason posts waive-docs carrying that very text.
test("submitting a non-empty reason posts a waive-docs action carrying that text", () => {
  const posted = gestures()[JSON.stringify("no user-facing change")];
  assert.deepEqual(posted, { action: "waive-docs", text: "no user-facing change" });
});

// INVARIANT: nothing at all is posted for a reason that is empty or only
// whitespace. Three shapes, because "blank" has more than one spelling.
test("a blank or whitespace-only reason posts nothing", () => {
  for (const blank of ["", "   ", "\t\n "]) {
    assert.equal(
      gestures()[JSON.stringify(blank)],
      null,
      `a reason of ${JSON.stringify(blank)} posted something — a waiver needs a stated reason`,
    );
  }
});

// INVARIANT: what is posted is the TRIMMED text, never the raw box, so a
// reason cannot arrive at the host padded with spaces it did not mean.
test("a padded reason is posted trimmed, not as it was typed", () => {
  assert.deepEqual(gestures()[JSON.stringify("  padded reason  ")], {
    action: "waive-docs",
    text: "padded reason",
  });
});
