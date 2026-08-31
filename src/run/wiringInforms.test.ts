/**
 * A doubt about a check's reach informs the person; it never withholds.
 *
 * The gate has two vetoes: a promise the work did not keep, and a product
 * that does not build. Coverage is neither. It cannot see a promise kept by
 * a file's text, one proved through a bundle, or one run under a runtime
 * that reports nothing executed — so a verdict drawn from it withholds work
 * for the instrument's own blind spots, and sends repair actors at checks
 * that already hold.
 *
 * The doubt is still worth the person's eye: a check that was not seen to
 * exercise its subject may prove less than it appears to. So it rides the
 * delivery as a finding, in words a reader who was never here can follow —
 * naming the check, saying what is uncertain, and saying plainly that
 * nothing here claims the work is wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { traceWiring } from "./wiringTrace";
import { unreachedNote } from "./wiring";

const SPACE = {
  nodes: [
    {
      id: "n-1",
      sentence: "every page handle appears in the surface",
      acceptance: [{ id: "ac-1", text: "the handle appears literally in the webview source" }],
      grounding: { touchpoints: [{ path: "webview/map/src/App.tsx" }] },
    },
  ],
} as never;

const SLICES = [{ handle: "SL-1", workUnits: [{ footprint: ["src/surfaces/pages_AC-1.test.ts"] }] }] as never;

/** Says the check never touched its subject — the verdict under test. */
const neverReached = async () => ({ executed: "no" as const, detail: "the drive passed without executing a line of x" });

const trace = async (over: Record<string, unknown> = {}) =>
  traceWiring({
    tep: "TEP-1",
    space: SPACE,
    slices: SLICES,
    acResults: [{ ac: 1, pass: true }],
    verifs: [{ ac: 1, run: "node --test out-test/surfaces/pages_AC-1.test.js" }],
    probeOfAc: new Map([[1, "src/surfaces/pages_AC-1.test.ts"]]),
    checkOf: new Map([["src/surfaces/pages_AC-1.test.ts", "every handle in PAGES appears in the webview source"]]),
    worktree: "/nowhere",
    exec: async () => ({ code: 0, output: "" }),
    log: () => {},
    defect: () => {},
    mapCriteria: () => new Map([["src/surfaces/pages_AC-1.test.ts", "ac-1"]]),
    proveWiring: neverReached,
    ...over,
  } as never);

test("a passing check the trace could not follow comes back as a note, not a verdict", async () => {
  const { unreached } = await trace();
  assert.equal(unreached.length, 1, "the doubt is carried, once");
  assert.match(unreached[0], /every handle in PAGES appears in the webview source/, "and it names the check a person read");
});

test("the trace hands back no verdict of its own for the gate to apply", async () => {
  const out = await trace();
  assert.deepEqual(
    Object.keys(out).sort(),
    ["criterionByProbe", "unreached"],
    "no wiring map escapes: nothing downstream can turn this doubt into red again",
  );
});

test("a check the trace did follow raises nothing", async () => {
  const { unreached } = await trace({
    proveWiring: async () => ({ executed: "yes", detail: "the drive executed webview/map/src/App.tsx" }),
  });
  assert.deepEqual(unreached, [], "a note for a check that plainly reached its subject is noise");
});

test("a runtime that reports nothing is not evidence against the work", async () => {
  const { unreached } = await trace({
    proveWiring: async () => ({ executed: "unknown", detail: "the runtime does not report what it executed" }),
  });
  assert.deepEqual(unreached, [], "the machine failing to look is a fact about the machine");
});

test("the note reads for someone who was not here", () => {
  const note = unreachedNote("every handle in PAGES appears in the webview source");
  for (const word of ["drive", "probe", "stub", "subject", "coverage", "wiring", "exit "])
    assert.doesNotMatch(note, new RegExp(word, "i"), `"${word}" is this machine's word, not a reader's`);
  assert.match(note, /this check passed/i, "it says the check held, which is the first thing a reader needs");
  assert.match(note, /Nothing here says the work is wrong/i, "and refuses the accusation it does not have evidence for");
});
