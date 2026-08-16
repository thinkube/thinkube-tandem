/**
 * The write fence and the blinding, as they really run.
 *
 * The arithmetic of containment was already covered; these cover the wiring
 * — that a stray edit is undone ON DISK, that a live peer's work is left
 * alone, and that held-out evidence is recognised wherever this product
 * happens to write it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { encloseWork, isHeldOut, refusedToolUse } from "./worker";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { GREEN_PROBE, spaceWithOneChange, tmpRepo as harnessRepo, writeInto } from "./runHarness";
import { coderTestPaths, foldBlastRadius } from "./plan";
import { ownership } from "./fence";
import { buildUnitDag, type SliceForDag } from "../engine/core/dag";
import { validateDag } from "../engine/methodology/parallelSlices";

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-fence-"));
  const g = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", dir], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "seed"]);
  return dir;
}

test("a probe is held-out evidence wherever it lives — never folded into a coder's footprint", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  // A probe from an EARLIER delivery that imports a source this cut changes.
  fs.mkdirSync(path.join(repo, "probes"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "probes", "old__SL-1_AC-1.test.mjs"),
    'import { greet } from "../src/greet.ts";\n',
  );
  fs.writeFileSync(path.join(repo, "src", "greet.ts"), "export const greet = () => 'hi';\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "an earlier delivery's probe"]);
  const exec = async (cmd: string, args: string[], cwd: string) => ({
    code: 0,
    out: execFileSync(cmd, args, { cwd, encoding: "utf8" }),
  });

  const slices: SliceForDag[] = [
    {
      handle: "SL-1",
      status: "ready",
      files: ["src/greet.ts"],
      workUnits: [{ footprint: ["src/greet.ts"], execution: "serial", role: "code" }],
    },
  ];
  const refusal = await foldBlastRadius(slices, repo, exec as never, () => {});

  assert.ok(refusal, "the run is refused rather than the probe being folded in");
  assert.match(refusal!, /probes\/old__SL-1_AC-1\.test\.mjs/);
  assert.deepEqual(
    slices[0].workUnits[0].footprint,
    ["src/greet.ts"],
    "and the coder's write fence never opened on it",
  );
});

test("a coder's tool use on a test is refused before it runs; a tester's is not", () => {
  const coder = { role: "code" as const, blind: true };
  assert.match(refusedToolUse(coder, "Write", "src/run/dispatch.test.ts") ?? "", /tester's/);
  assert.match(refusedToolUse(coder, "Edit", "probes/x.test.mjs") ?? "", /tester's/);
  assert.match(refusedToolUse(coder, "Read", "probes/x.test.mjs") ?? "", /held out/);
  assert.equal(refusedToolUse(coder, "Edit", "src/run/dispatch.ts"), undefined, "production is the coder's");
  assert.equal(
    refusedToolUse({ role: "code", blind: false }, "Write", "src/a.test.ts")?.includes("tester's"),
    true,
    "even an unblinded coder never writes a test",
  );
  assert.equal(refusedToolUse({ role: "test" }, "Edit", "src/gates/gates.test.ts"), undefined, "the tester's own");
  assert.equal(refusedToolUse(coder, "Write", ""), undefined, "no target, no refusal");
});

test("held-out evidence is recognised wherever a coder might reach for it", () => {
  for (const t of [
    "probes/space__SL-1_AC-1.test.mjs",
    "./probes/x.test.mjs",
    "src/gates/doors.test.ts",
    "src/acceptance/thing.mjs",
    "-n pattern probes/",
  ])
    assert.ok(isHeldOut(t), `${t} should be held out`);
  for (const t of ["src/gates/doors.ts", "docs/index.adoc", "package.json"])
    assert.equal(isHeldOut(t), false, `${t} is the coder's own work`);
});

test("the write fence really reverts: a stray file is undone on disk and the unit strays", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "mine.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(repo, "src", "theirs.ts"), "export const b = 1;\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "base"]);

  // The unit edits its own file, and also someone else's.
  fs.writeFileSync(path.join(repo, "src", "mine.ts"), "export const a = 2;\n");
  fs.writeFileSync(path.join(repo, "src", "theirs.ts"), "export const b = 2;\n");
  const said: string[] = [];
  const strayed = await encloseWork({
    worktree: repo,
    footprint: ["src/mine.ts"],
    baseline: new Set(),
    log: (l) => said.push(l),
  });

  assert.equal(strayed, true, "writing outside the footprint is a stray");
  assert.equal(
    fs.readFileSync(path.join(repo, "src", "theirs.ts"), "utf8"),
    "export const b = 1;\n",
    "the stray edit is gone from disk, not merely reported",
  );
  assert.equal(
    fs.readFileSync(path.join(repo, "src", "mine.ts"), "utf8"),
    "export const a = 2;\n",
    "and the unit's own work is untouched",
  );
  assert.ok(said.some((l) => /containment: src\/theirs\.ts/.test(l)));
});

test("a live peer's files are allowed, so the frontier can share a tree", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "peer.ts"), "export const b = 1;\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "base"]);
  fs.writeFileSync(path.join(repo, "src", "peer.ts"), "export const b = 2;\n");

  const strayed = await encloseWork({
    worktree: repo,
    footprint: ["src/mine.ts"],
    alsoAllowed: () => ["src/peer.ts"],
    baseline: new Set(),
    log: () => {},
  });
  assert.equal(strayed, false);
  assert.equal(fs.readFileSync(path.join(repo, "src", "peer.ts"), "utf8"), "export const b = 2;\n");
});

test("a covering test another unit depends on is not folded — the plan stays acyclic", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  // Two units land in different files; one test covers both, and that test
  // is the file the second unit names as its dependency on the first.
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(repo, "src", "b.ts"), "export const b = 2;\n");
  fs.writeFileSync(
    path.join(repo, "src", "both.test.ts"),
    'import { a } from "./a.ts";\nimport { b } from "./b.ts";\n',
  );
  g(["add", "-A"]);
  g(["commit", "-qm", "two sources under one test"]);
  const exec = async (cmd: string, args: string[], cwd: string) => ({
    code: 0,
    out: execFileSync(cmd, args, { cwd, encoding: "utf8" }),
  });

  const slices: SliceForDag[] = [
    {
      handle: "SL-1",
      status: "ready",
      files: ["src/a.ts", "src/both.test.ts"],
      workUnits: [
        { footprint: ["src/a.ts", "src/both.test.ts"], execution: "serial", role: "code" },
      ],
    },
    {
      handle: "SL-2",
      status: "ready",
      files: ["src/b.ts"],
      workUnits: [
        {
          footprint: ["src/b.ts"],
          execution: "serial",
          role: "code",
          consumes: ["src/a.ts", "src/both.test.ts"],
        } as never,
      ],
    },
  ];
  const refusal = await foldBlastRadius(slices, repo, exec as never, () => {});
  assert.equal(refusal, null, "nothing here is held-out evidence");
  assert.deepEqual(
    slices[1].workUnits[0].footprint,
    ["src/b.ts"],
    "the test belongs to the unit SL-2 depends on, so SL-2 does not become a second producer of it",
  );

  // A dependency is declared as a FILE and resolves to EVERY unit holding
  // it, so a second producer of a consumed file is an edge in both
  // directions — and the engine refuses a circle by refusing the whole run.
  const dag = buildUnitDag(slices);
  assert.deepEqual(validateDag(dag) as unknown, { ok: true });
});

test("a finished unit's work is not a stray for a unit still running beside it", async () => {
  // Every test author shares one worktree. The first to finish leaves its
  // probes written; the ones still running must not be blamed for them,
  // and above all must not have them reverted underneath.
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, "probes"), { recursive: true });
  const mine = "probes/space__SL-1_AC-1.test.mjs";
  const theirs = "probes/space__SL-3_AC-1.test.mjs";
  fs.writeFileSync(path.join(repo, mine), "// mine\n");
  fs.writeFileSync(path.join(repo, theirs), "// written by a tester that has finished\n");

  const lines: string[] = [];
  const violated = await encloseWork({
    worktree: repo,
    footprint: [mine],
    // What every OTHER unit owns in this tree, whether or not it is still
    // running — ownership is not liveness.
    alsoAllowed: () => [theirs],
    baseline: new Set(),
    log: (l) => lines.push(l),
  });

  assert.equal(violated, false, "another unit's file is not this unit's stray");
  assert.deepEqual(lines, [], "and nothing is reported");
  assert.ok(fs.existsSync(path.join(repo, theirs)), "above all, it is not reverted");
});

test("a path nobody owns is still a stray", async () => {
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, "probes"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "probes/space__SL-1_AC-1.test.mjs"), "// mine\n");
  fs.writeFileSync(path.join(repo, "src/wandered.ts"), "export const x = 1;\n");

  const lines: string[] = [];
  const violated = await encloseWork({
    worktree: repo,
    footprint: ["probes/space__SL-1_AC-1.test.mjs"],
    alsoAllowed: () => ["probes/space__SL-3_AC-1.test.mjs"],
    baseline: new Set(),
    log: (l) => lines.push(l),
  });

  assert.equal(violated, true, "a file belonging to no unit at all is a stray");
  assert.match(lines[0], /src\/wandered\.ts/);
});

test("ownership is not liveness: every unit's footprint is respected, finished or not", () => {
  const unionFor = ownership(
    [
      { id: "SL-1#eu-1", footprint: ["probes/a.test.mjs"], role: "test" },
      { id: "SL-3#eu-1", footprint: ["probes/b.test.mjs"], role: "test" },
      { id: "SL-1#eu-0", footprint: ["src/one.ts"], role: "code" },
    ],
    (u) => (u.role === "test" ? "/tester" : "/coder"),
  );
  assert.deepEqual(
    unionFor("/tester", "SL-1#eu-1")(),
    ["probes/b.test.mjs"],
    "the other tester's probes, whether or not it is still running",
  );
  assert.deepEqual(unionFor("/tester", "SL-3#eu-1")(), ["probes/a.test.mjs"]);
  assert.deepEqual(
    unionFor("/coder", "SL-1#eu-0")(),
    [],
    "and nothing from another tree — a coder never sees the testers' work",
  );
});

test("a test the change would break folds into the TESTER's footprint — the coder never holds a test", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(repo, "src", "a.test.ts"), 'import { a } from "./a.ts";\n');
  g(["add", "-A"]);
  g(["commit", "-qm", "a source under a test"]);
  const exec = async (cmd: string, args: string[], cwd: string) => ({
    code: 0,
    out: execFileSync(cmd, args, { cwd, encoding: "utf8" }),
  });
  const slices: SliceForDag[] = [
    {
      handle: "SL-1",
      status: "ready",
      files: ["src/a.ts"],
      workUnits: [
        { footprint: ["src/a.ts"], execution: "serial", role: "code" },
        { footprint: ["probes/sp__SL-1_AC-1.test.mjs"], execution: "serial", role: "test" },
      ],
    },
  ];
  const said: string[] = [];
  const refusal = await foldBlastRadius(slices, repo, exec as never, (l) => said.push(l));
  assert.equal(refusal, null);
  assert.deepEqual(slices[0].workUnits[0].footprint, ["src/a.ts"], "the coder's footprint is untouched");
  assert.deepEqual(
    slices[0].workUnits[1].footprint,
    ["probes/sp__SL-1_AC-1.test.mjs", "src/a.test.ts"],
    "the tester brings the covering test under, beside its probe",
  );
  assert.deepEqual(coderTestPaths(slices), [], "the plan keeps the roles' invariant");
  slices[0].workUnits[0].footprint.push("src/a.test.ts");
  assert.deepEqual(coderTestPaths(slices), ["SL-1#eu-0: src/a.test.ts"], "a coder holding a test is named");
});

test("the tester's files riding into the code tree at slice commit are never a live coder's strays", async () => {
  const repo = harnessRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-35" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let allowedForCoder: string[] = [];
  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        allowedForCoder = w.alsoAllowed?.() ?? [];
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  const probe = slices[0].workUnits.find((u) => u.role === "test")!.footprint[0];
  assert.ok(allowedForCoder.includes(probe), "a probe copied in by the run is not the coder's stray — the commit cannot be reverted under it");
});
