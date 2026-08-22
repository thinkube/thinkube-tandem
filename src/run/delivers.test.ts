/**
 * The one claim the machine exists to make: **a run delivers.**
 *
 * A real repository, a real ask, the real dispatcher, in each of the four
 * shapes a repository can take — no build, a build that mirrors the source
 * tree with or without its leading directory, and a build with no way to
 * run one test alone. Only the model call is scripted, because a test
 * cannot afford one; everything else is the machine.
 *
 * This is the acceptance for every removal that follows. A change to the
 * run loop is allowed when this still passes, and not otherwise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { SHAPES, repoInShape, scriptedWorker } from "./shapes";
import { refusedToolUse } from "./worker";
import type { RepoShape } from "./shapes";

/** One ask, one promise, one criterion — the content is never the point. */
function oneAsk(): { space: ReturnType<typeof emptySpace>; ids: string[] } {
  let s = emptySpace();
  const a = addAsk(s, "greet the user", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, ids: [n.added.id] };
}

for (const shape of SHAPES as readonly RepoShape[])
  test(`a run delivers in a repository where ${shape.name}`, async () => {
    const repo = repoInShape(shape);
    const before = new Set(
      execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", "HEAD"]).toString().split("\n"),
    );
    const { space, ids } = oneAsk();
    const cut = { id: "cut-1", changeIds: ids, tepId: `TEP-${shape.name.slice(0, 8).replace(/\W/g, "")}` };
    const state = new RunState(() => {});
    const said: string[] = [];
    state.sink = (line) => said.push(line);
    const outcome = await dispatchTep(
      {
        repoRoot: repo,
        model: "sonnet",
        suiteCommand: ["node", "-e", "process.exit(0)"],
        ...(shape.prepare ? { prepare: shape.prepare } : {}),
        ...(shape.runOne ? { runOne: shape.runOne } : {}),
        state,
        supervisorRound: async () => null,
        spaceName: "delivers",
        worker: scriptedWorker(shape, "honest").worker as never,
      } as never,
      space,
      cut,
      tepSlices({ space, cut, spaceName: "delivers" }),
    );

    // What the person asked for is on the branch, and the delivery is open.
    assert.ok(outcome.delivery, "the run reached a delivery");
    assert.equal(outcome.delivery?.withheld, undefined, `the delivery was withheld: ${outcome.delivery?.withheld}`);
    assert.deepEqual(
      [...state.units.values()].filter((u) => u.state !== "done").map((u) => `${u.id}: ${u.state} ${u.note ?? ""}`),
      [],
      "every unit finished",
    );
    assert.ok(fs.existsSync(path.join(repo, "src", "greet.mjs")) === false, "the work lands on the branch, not in the base checkout");
    assert.ok(
      outcome.delivery!.proofs.some((p) => p.kind === "probe" && p.verdict === "green"),
      "and the promise carries a proof that ran",
    );

    // The run proves the promise; it does not grow the repository's suite.
    // Every check is evidence on the delivery, and none of them rides the
    // merge into the delivered tree.
    const delivered = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", outcome.delivery!.branch])
      .toString()
      .split("\n")
      .filter(Boolean);
    assert.deepEqual(
      delivered.filter((p) => p.startsWith("probes/")),
      [],
      "no check rode the merge",
    );
    assert.deepEqual(
      delivered.filter((p) => /\.test\.|\.spec\./.test(p)).filter((p) => !before.has(p)),
      [],
      "the delivery installed no test into the repository",
    );

    // A check is born where this repository keeps its tests — beside the
    // module it drives, in the suffix its own tests wear — never under a
    // coordinate of the run.
    assert.ok(
      said.some((l) => /check\(s\) born in the repository's own test homes/.test(l)),
      `no check was rehoused: ${said.filter((l) => /check/.test(l)).slice(0, 3).join(" | ")}`,
    );
    assert.ok(
      said.some((l) => /src\/greet_AC-1\.test\.mjs/.test(l)),
      "and it is named for its subject and its criterion",
    );

    // One tree per repository. A second tree inside a repository is what
    // the probe store, the runner overlay and the closer's misplaced fix
    // all existed to reconcile.
    const trees = execFileSync("git", ["-C", repo, "worktree", "list", "--porcelain"])
      .toString()
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length));
    assert.deepEqual(
      trees.filter((t) => t.endsWith("-tester")),
      [],
      "the run left no tester tree",
    );
  });

test("a blinded coder is refused the checks, and a coder never writes one", () => {
  // Blinding is a permission, not an absence: the checks sit beside the
  // code in one tree, and the guard is what keeps the author off them.
  assert.match(
    refusedToolUse({ role: "code", blind: true }, "Read", "src/run/gate.test.ts") ?? "",
    /held out/,
    "a blinded coder cannot read a check",
  );
  assert.match(
    refusedToolUse({ role: "code" }, "Write", "probes/x_AC-1.test.mjs") ?? "",
    /tests are the tester's/,
    "and no coder writes one, blinded or not",
  );
  assert.equal(
    refusedToolUse({ role: "code", blind: true }, "Read", "src/run/gate.ts"),
    undefined,
    "while production code stays readable",
  );
  assert.equal(
    refusedToolUse({ role: "test", blind: false }, "Write", "probes/x_AC-1.test.mjs"),
    undefined,
    "and the tester writes its own checks",
  );
});
