/**
 * A stalled oracle answers a changed tree.
 *
 * Two identical rounds from actors who changed nothing latched the guard
 * for the rest of the run; the actor who then fixed the cause was refused
 * three times without a check ever running, and the promise ended unkept
 * on a tree that would have held.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerifyOracle } from "../engine/verifyOracle";

function oracle(tree: { text: string }, code: { value: number }) {
  return createVerifyOracle({
    codeWorktree: "/code",
    testerWorktree: "/tests",
    runnerDir: "/runner",
    probeFiles: [],
    verifications: [{ ac: 1, run: "check", env: "local" }],
    exec: async () => ({ code: code.value, output: code.value ? "not ok 1 - the sort is wrong" : "ok 1" }),
    porcelain: async () => " M app.py",
    resetRunner: async () => {},
    copyIn: async () => {},
    removeIn: async () => {},
    readFile: async () => tree.text,
  });
}

test("the guard latches on an unchanged tree and lifts when the tree changes", async () => {
  const tree = { text: "v1" };
  const code = { value: 1 };
  const o = oracle(tree, code);
  assert.equal((await o.verify()).kind, "results");
  assert.equal((await o.verify()).kind, "results");
  assert.equal((await o.verify()).kind, "stalled", "the same tree, the same answer: nothing to learn");
  assert.equal((await o.verify()).kind, "stalled");
  tree.text = "v2";
  code.value = 0;
  const r = await o.verify();
  assert.equal(r.kind, "results", "a changed tree is a new question");
  assert.ok(r.kind === "results" && r.results[0].pass);
});
