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
import * as os from "node:os";
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

/**
 * A repository with no way to run ONE of its tests cannot be judged.
 *
 * Every promise is proved by running its check alone and reading that
 * verdict. Where no such command exists the run used to fall back to
 * `node --test <probe>` — right in one language, "command not found" in
 * every other, and a check that cannot run is a red check, which is an
 * unkept promise. The machine's own ignorance came back as the person's
 * work failing. The run now stops at the door and names what is missing.
 */
for (const shape of SHAPES.filter((s) => !s.runOne) as readonly RepoShape[])
  test(`a run refuses in a repository where ${shape.name}`, async () => {
    const repo = repoInShape(shape);
    const { space, ids } = oneAsk();
    const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-nosingle" };
    const state = new RunState(() => {});
    const outcome = await dispatchTep(
      {
        repoRoot: repo,
        model: "sonnet",
        told: { suite: "true", ...(shape.prepare ? { prepare: shape.prepare } : {}) },
        state,
        supervisorRound: async () => null,
        spaceName: "delivers",
        worker: scriptedWorker(shape, "honest").worker as never,
      } as never,
      space,
      cut,
      tepSlices({ space, cut, spaceName: "delivers" }),
    );
    assert.equal(outcome.delivery, undefined, "nothing is handed over");
    assert.match(
      outcome.refusals?.[0] ?? "",
      /run one check/,
      "and the refusal names the fact that is missing, not a symptom",
    );
  });

for (const shape of SHAPES.filter((s) => s.runOne) as readonly RepoShape[])
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
        told: {
          suite: "true",
          ...(shape.prepare ? { prepare: shape.prepare } : {}),
          ...(shape.runOne ? { runOne: shape.runOne } : {}),
        },
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
    assert.ok(outcome.delivery, `the run reached a delivery — said:\n${said.slice(-6).map((l) => l.slice(0, 160)).join("\n")}`);
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

    // The checks a run writes STAY. Each carries the promise it proves,
    // which is what lets a later cut retire it when that promise is
    // overruled — and it is the proof the person paid the run to produce.
    // What must never ride the merge is a check under a coordinate of the
    // run: `probes/` is the run's own scratch space, not the repository's.
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
      ["src/greet_AC-1.test.mjs"],
      "the delivery hands the repository the check that proves its promise",
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

test("a delivered cut can be proven again — the record gives its checks back", async () => {
  // A delivery consumes its checks. Run the same cut a second time — the
  // person pressed run again, or the acceptance proves it three times —
  // and the standing testers must not be asked for files a delivery
  // deliberately removed. What the record kept comes back.
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-again" };
  const once = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "delivers",
      storeDir: store,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );
  assert.ok(once.delivery && !once.delivery.withheld, "the first run delivered");

  const again = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "delivers",
      storeDir: store,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );
  assert.ok(again.delivery, "the second run reached a delivery");
  assert.equal(again.delivery?.withheld, undefined, `the second run was withheld: ${again.delivery?.withheld}`);
  // The fixture has no remote, so the push proof is honestly red in both
  // runs; the promises' own proofs are what the restore must keep green.
  const still = again.delivery!.proofs.filter((p) => p.kind !== "ci" && p.verdict !== "green");
  assert.deepEqual(
    still.map((p) => `${p.label}: ${p.ref ?? ""}`),
    [],
    "every promise is proven again",
  );
});

/**
 * The only two things that stop a delivery.
 *
 * A promise that is not kept, and a tree that does not build as the
 * repository ships it. Everything else the run notices rides along as a
 * finding for the person to weigh. These two are withheld whatever the
 * rest of the suite says, because handing over work that does not do what
 * was promised, or does not ship, is not a delivery.
 */
test("the two vetoes: an unkept promise and a product that does not build", async () => {
  {
  // The coder's work never satisfies the check and never changes, and the
  // closer cannot save it either: there is nothing to deliver.
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-withheld" };
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      state,
      supervisorRound: async () => null,
      spaceName: "delivers",
      worker: scriptedWorker(shape, "unchanging", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );

  assert.ok(outcome.delivery, "the run still reaches a terminal state");
  assert.ok(outcome.delivery?.withheld, "and it is withheld, not opened");
  assert.match(outcome.delivery!.withheld!, /not kept/);
  assert.equal(outcome.url, undefined, "nothing was handed over");

  // A withheld run keeps its evidence: the checks stay on the branch, for
  // the person to read and the next run to resume from. Only an OPENED
  // delivery discards them.
  const held = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", outcome.delivery!.branch])
    .toString()
    .split("\n");
  assert.ok(
    held.some((p) => /_AC-\d/.test(p)),
    `the withheld branch lost its checks: ${held.filter((p) => p.includes("test")).join(", ")}`,
  );
  }
  {
  // Three runs once reported deliveries of a branch the product build
  // rejected: the gate proved the test build only. The product build is
  // green on the untouched tree and red once the coder's file exists — so
  // the door passes, every check passes, and the gate must still refuse.
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-noship" };
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      build: "test ! -e src/greet.mjs",
      state,
      supervisorRound: async () => null,
      spaceName: "delivers",
      worker: scriptedWorker(shape, "honest", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );
  assert.ok(outcome.delivery, "the run reached a terminal state");
  assert.ok(outcome.delivery?.withheld, "and it was withheld");
  assert.match(outcome.delivery!.withheld!, /does not build as shipped/);
  }
});

