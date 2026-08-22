/**
 * The machine, run against the repository shapes it claims to support, by
 * workers that misbehave the way real ones do.
 *
 * Its right to exist is falsifiable: it must reproduce the regressions that
 * reached the field — the check audit judging a tree with no build output,
 * and a wait for work nobody could deliver. A harness that cannot fail on
 * known defects proves nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { auditProbe } from "./probeAudit";
import { MIRROR_STRIPPED, SHAPES, repoInShape, scriptedWorker } from "./shapes";
import type { RepoShape } from "./shapes";

/** One ask, one promise, two checks — the content is never the point. */
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

async function runIn(
  shape: RepoShape,
  how: Parameters<typeof scriptedWorker>[1],
  opts: { closerFixes?: boolean; standingRed?: boolean } = {},
) {
  const repo = repoInShape(shape, { standingRed: !!opts.standingRed });
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: `TEP-${shape.name.slice(0, 6).replace(/\W/g, "")}-${how}` };
  const state = new RunState(() => {});
  const scripted = scriptedWorker(shape, how, opts.closerFixes ?? true);
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.prepare ? { prepare: shape.prepare } : {}),
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      ...(opts.standingRed ? { suiteReds: ["src/gate.test.mjs"] } : {}),
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "shapes",
      worker: scripted.worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "shapes" }),
  );
  return { repo, state, outcome, scripted };
}

for (const shape of SHAPES)
  test(`the machine delivers in a repository where ${shape.name}`, async () => {
    const { state, outcome } = await runIn(shape, "honest");
    const bad = [...state.units.values()].filter((u) => u.state !== "done");
    assert.deepEqual(
      bad.map((u) => `${u.id}: ${u.state} ${u.note ?? ""}`),
      [],
      `every unit finished in this shape (${shape.name})`,
    );
    assert.ok(outcome.delivery && !outcome.delivery.withheld, "and the delivery is opened");
  });

test("REGRESSION (v2.0.132): the audit must not fault a check because the tester's tree holds no build output", async () => {
  // The shape that broke it: the build emits into out/, and the tester's
  // snapshot never holds that directory. Judged there, every compiled
  // import looked impossible and correct checks were sent to be mended.
  const repo = repoInShape(MIRROR_STRIPPED);
  const testerLike = fs.mkdtempSync(path.join(repo, "..", "tester-"));
  execFileSync("git", ["-C", repo, "worktree", "add", "--detach", "-q", testerLike]);
  assert.ok(!fs.existsSync(path.join(testerLike, "out")), "the tester's tree has no build output — the field condition");
  fs.mkdirSync(path.join(testerLike, "probes"), { recursive: true });
  const emitMap = ["src/hello.mjs → out/hello.mjs"];

  const honest = auditProbe("probes/p.test.mjs", `import { hello } from "../out/hello.mjs";`, testerLike, [], emitMap);
  assert.deepEqual(honest, [], "a correct compiled import is never faulted, even with nothing built here");

  const planned = auditProbe("probes/p.test.mjs", `import { greet } from "../out/greet.mjs";`, testerLike, ["src/greet.mjs"], emitMap);
  assert.deepEqual(planned, [], "a module this run will write is not faulted either");

  const wrong = auditProbe("probes/p.test.mjs", `import { greet } from "../out/src/greet.mjs";`, testerLike, ["src/greet.mjs"], emitMap);
  assert.equal(wrong.length, 1, "and the path that inverts to src/src IS faulted");
  assert.match(wrong[0].detail, /src\/src/);
  execFileSync("git", ["-C", repo, "worktree", "remove", "--force", testerLike]);
});

test("REGRESSION (v2.0.134): a unit green on its own checks delivers, even where the repository's suite is red in files it does not own", async () => {
  // The run this comes from failed four units this way. Every one of them
  // had all its own checks green; every one was reworked twice, closed and
  // failed for standing tests broken by another slice's uncommitted work,
  // in files none of them could edit. The machine called it "your code".
  const { state, outcome, scripted } = await runIn(MIRROR_STRIPPED, "honest", { standingRed: true });
  const bad = [...state.units.values()].filter((u) => u.state !== "done");
  assert.deepEqual(bad.map((u) => `${u.id}: ${u.state} ${u.note ?? ""}`), [], "no unit is failed for a red it did not cause");
  assert.ok(outcome.delivery, "the run reaches a delivery");
  assert.equal(scripted.briefs.filter((b) => /You are the CLOSER/.test(b.brief)).length, 0, "and no closer was needed");
});

test("a tester that writes an impossible import is mended once, and the run still delivers", async () => {
  const { state, outcome, scripted } = await runIn(MIRROR_STRIPPED, "wrong-import");
  const mended = scripted.briefs.filter((b) => /cannot stand as written/.test(b.brief));
  assert.equal(mended.length, 1, "one mend, never a grind");
  assert.match(mended[0].brief, /compiled form of|resolves to/, "and it is told what is wrong, in the machine's own words");
  assert.ok(outcome.delivery, "the run reaches a delivery");
  void state;
});

test("a coder whose work never changes hands up after one repeat, and the closer finishes it", async () => {
  const { state, outcome, scripted } = await runIn(MIRROR_STRIPPED, "unchanging");
  const coderRounds = scripted.briefs.filter((b) => /REWORK|Task/.test(b.brief) && !/CLOSER/.test(b.brief)).length;
  assert.ok(coderRounds <= 4, `the coder is not allowed to grind (${coderRounds} briefs)`);
  assert.ok(
    scripted.briefs.some((b) => /You are the CLOSER/.test(b.brief)),
    "the closer took it once the cheap rungs were spent",
  );
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "and it was finished");
  assert.equal([...state.units.values()].filter((u) => u.state === "failed").length, 0);
});

test("when even the closer cannot finish, the unit fails with its report and the run says so — no silence", async () => {
  const { state, outcome } = await runIn(MIRROR_STRIPPED, "unchanging", { closerFixes: false });
  const failed = [...state.units.values()].filter((u) => u.state === "failed");
  assert.ok(failed.length >= 1, "the unit fails rather than looping");
  assert.match(failed[0].note ?? "", /closer/i, "and the note says the closer was spent");
  assert.ok(outcome.undelivered.length >= 1, "what remains is named on the delivery");
});
