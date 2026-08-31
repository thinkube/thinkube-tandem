/**
 * A check reaches its subject by reading it, when reading is the proof.
 *
 * Execution is the right instrument for a promise about behaviour: a stub
 * satisfies an assertion but cannot appear on a path nothing reaches. It is
 * the wrong instrument for a promise about a file's TEXT.
 *
 * A delivery of a hundred and ninety proofs was withheld on three of them,
 * all for the same complaint — "the drive passed without executing a line
 * of…". All three checks passed. Two of their criteria say, in the words
 * the person signed, that a handle must "appear literally in the webview
 * source, READING THE SOURCE FILES, not the built bundle"; the third is
 * that no file exceeds six hundred lines. The rule failed those checks for
 * obeying their own criterion, and no check could ever have satisfied both.
 *
 * The escape already existed for a subject execution cannot reach — a
 * document, a data file: "keeps a promise by its content, and execution can
 * neither prove nor refute it". This is that same rule, keyed on what the
 * CHECK does rather than on the subject's extension.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { provedByExecution } from "./wiring";

/** A trace that records nothing of the subject — the case under test. */
const ranNothingRelevant = async () => ({ code: 0, output: "" });

test("a check that reads its subject is not accused of never reaching it", async () => {
  const v = await provedByExecution({
    run: "node --test out-test/surfaces/pages_AC-4.test.js",
    subjects: ["webview/map/src/App.tsx", "webview/map/src/Delivery.tsx"],
    worktree: "/nowhere",
    exec: ranNothingRelevant,
    probeSource: `const src = readFileSync(join(root, "webview/map/src/App.tsx"), "utf8");
                  assert.match(src, /data-work-page/);`,
  });

  assert.notEqual(v.executed, "no", "a red here withholds a delivery for a check doing what its criterion asks");
  assert.equal(v.executed, "unknown");
  assert.match(v.detail, /proves its promise by READING/);
  assert.match(v.detail, /kept by[\s\S]*text/, "and says why execution is the wrong instrument");
});

test("a walking check counts too — it names no path and reads them all", async () => {
  // The module-size check opens every file under src/ and measures it. It
  // never mentions any subject by name, so matching paths would miss it.
  const v = await provedByExecution({
    run: "node --test out-test/hygiene.test.js",
    subjects: ["src/run/gate.ts", "src/run/dispatch.ts"],
    worktree: "/nowhere",
    exec: ranNothingRelevant,
    probeSource: `for (const name of readdirSync(dir)) { const lines = readFileSync(p, "utf8").split("\\n").length; }`,
  });
  assert.equal(v.executed, "unknown");
});

test("a check that does not read is still judged by execution, as before", async () => {
  const v = await provedByExecution({
    run: "node --test out-test/surfaces/thing_AC-1.test.js",
    subjects: ["src/surfaces/thing.ts"],
    worktree: "/nowhere",
    exec: ranNothingRelevant,
    probeSource: `import { thing } from "../../src/surfaces/thing";
                  assert.equal(thing("a"), "b");`,
  });
  assert.doesNotMatch(
    v.detail,
    /proves its promise by READING/,
    "a behaviour promise still goes to the trace — a stub must not pass by claiming it read something",
  );
});

test("no source in hand leaves the rule exactly as it was", async () => {
  const v = await provedByExecution({
    run: "node --test out-test/x.test.js",
    subjects: ["src/x.ts"],
    worktree: "/nowhere",
    exec: ranNothingRelevant,
  });
  assert.doesNotMatch(v.detail, /READING/, "a caller that supplies no source gets the rule unchanged");
});
