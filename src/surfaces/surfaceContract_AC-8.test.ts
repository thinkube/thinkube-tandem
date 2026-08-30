/**
 * INVARIANT — every caller of noteAllowed must hand it the phase the same
 * push carried, not just the allowed list. Without the phase, the sentence
 * refusalIfRefused renders for an action outside the allowed list can only
 * be the bare fallback, naming no control — so after recording an allowed
 * list together with a phase, the refused-press lookup for an action
 * outside that list must return a sentence naming the control and giving
 * that phase's own reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { noteAllowed, refusalIfRefused, refusalSentence, CONTROL_NAMES, SpacePush } from "./surfaceContract";

const repo = path.resolve(__dirname, "..", "..");
const harnessBundle = path.join(repo, "out-test", "harness", "buttons.cjs");

/**
 * The button harness, bundled for node and loaded. The harness is webview
 * code: it imports React and JSX, which the host's own test build does not
 * compile, so it is reached through the bundle its own vite config already
 * produces rather than by importing the .tsx directly.
 *
 * Built here when it is absent, because `pretest` builds the webview but
 * not this harness. A failure to build is raised, never swallowed: a check
 * that quietly skips when it cannot reach its subject is green for a stub
 * as readily as for the real caller, which is the exact failure this file
 * exists to prevent.
 */
function loadHarness(): { tableFor(push: SpacePush): Record<string, string[]> } {
  if (!fs.existsSync(harnessBundle)) {
    execFileSync("npm", ["run", "buttons"], {
      cwd: path.join(repo, "webview", "map"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(harnessBundle);
}

/** A push carrying every field the surface requires, in one phase. */
function pushIn(phase: SpacePush["phase"], allowed: string[]): SpacePush {
  return {
    kind: "space",
    running: false,
    phase,
    allowed,
    signedTeps: 0,
    questions: [],
    decisions: [],
    orphans: [],
    sentences: [],
    cost: { subjects: 0, rounds: 0 },
    outOfDate: { promises: 0, subjects: 0, rounds: 0 },
    ready: { subjects: 0, promises: 0, asks: 0, thinking: false },
    draft: "",
    impacts: [],
    subjects: [],
    cutCount: 0,
    deliveries: [],
    documentation: { state: "landed", landings: [] },
  } as SpacePush;
}

test("recording an allowed list with a phase makes the refused-press sentence name the control and the phase's reason", () => {
  noteAllowed(["rerun"], "signed");

  const sentence = refusalIfRefused("build");
  assert.ok(sentence, "build is outside the allowed list, so a refusal sentence must come back");

  const controlName = CONTROL_NAMES["build"];
  assert.ok(controlName, "the build action must have a control name");
  assert.ok(
    sentence!.includes(controlName),
    `the sentence must name the control ("${controlName}"): got "${sentence}"`,
  );

  assert.equal(
    sentence,
    refusalSentence("build", "signed"),
    "the sentence must match refusalSentence for the phase actually recorded with noteAllowed",
  );
});

test("the real caller records the phase with the allowed list, so a refused control's row names the control and the phase's reason", () => {
  // The assertions above drive noteAllowed from the check itself, which
  // proves the lookup and not the caller: they stay green for a caller that
  // hands over the allowed list and drops the phase. The invariant is about
  // every CALLER, so the surface's own caller is the one driven here —
  // tableFor renders each page and records the push's allowed list itself.
  const { tableFor } = loadHarness();

  const phase: SpacePush["phase"] = "signed";
  const rows = Object.values(tableFor(pushIn(phase, ["rerun"]))).flat();
  assert.ok(rows.length > 0, "set up: the surface rendered at least one button");

  const off = rows.filter((r) => r.startsWith("off "));
  assert.ok(off.length > 0, `set up: at least one control is off in phase "${phase}"`);

  // Every off control the phase governs carries a sentence, and that
  // sentence is the one refusalSentence gives for the phase the push
  // carried. A caller that dropped the phase renders the reasonless
  // fallback instead, and every one of these rows fails.
  const governed = off.filter((r) => r.includes(" — "));
  assert.ok(
    governed.length > 0,
    `no off control carried a refusal sentence — the caller recorded no phase:\n${off.join("\n")}`,
  );

  for (const row of governed) {
    const action = row.slice(4).split(/[ =]/)[0];
    const expected = refusalSentence(action, phase);
    assert.ok(
      row.endsWith(` — ${expected}`),
      `the row for "${action}" must end with the sentence for phase "${phase}" ("${expected}"): got "${row}"`,
    );
    const name = CONTROL_NAMES[action];
    if (name) assert.ok(row.includes(name), `the row for "${action}" must name the control ("${name}")`);
  }
});
