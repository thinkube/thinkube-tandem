/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The repair the platform's own words ask for.
 *
 * The work is already in the project, so this is not a delivery being
 * judged — it is a product that does not build, with a log that names the
 * files. The closer answers it, seeing only that: what the platform said,
 * and the files it named. It may edit those and nothing else, and it is
 * measured by the repository's own build, here, in the tree the run
 * committed from. When the refused step is the pipeline's test step, the
 * build cannot reproduce it: the repair is measured by the repository's
 * whole suite (the setup facts' `suite`), and it may also edit the shared
 * test setup beside the test files the log names.
 *
 * The bound matters here more than at the gate: whatever this writes
 * arrives in a project that is already live.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isTestPath } from "../core/testShape";
import { close } from "./closer";
import { stageWork } from "./stageWork";
import { RunState } from "./state";

export async function repairAfterTheMerge(a: {
  tep: string;
  attempt: number;
  worktree: string;
  evidence: string;
  files: string[];
  deps: {
    repoRoot: string;
    model: string;
    build?: string;
    /** The repository's whole suite, from the setup facts. */
    suite?: string;
    prepare?: string;
    digest?: string;
    workerModel?: Parameters<typeof close>[0]["workerModel"];
    worker?: Parameters<typeof close>[0]["worker"];
  };
  st: RunState;
  exec: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
  boundedExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  /** How the whole suite is run: bounded by the suite's own time limit. */
  suiteExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  /** The refused step is the pipeline's test step. */
  testStep?: boolean;
  log: (line: string) => void;
  /** The repair is of what the reviewers found on the running product,
   *  not of a build the platform refused: their lines are the criteria,
   *  and an unchanged tree is not a repair, whatever the build says. */
  onTheProduct?: { criteria: string[] };
}): Promise<{ green: boolean; report: string }> {
  const step = `live#repair-${a.attempt}`;
  const suite = a.testStep && !a.onTheProduct ? a.deps.suite : undefined;
  if (a.testStep && !a.onTheProduct && !suite)
    throw new Error(
      "the platform's test step refused the work, and the setup facts (.tandem/setup.json) name no `suite` to reproduce it here — record the repository's whole-suite command there",
    );
  const build = async (): Promise<{ ok: boolean; output: string }> => {
    if (!a.deps.build) return { ok: true, output: "this repository declares no build" };
    const b = await a.boundedExec(a.deps.build, a.worktree);
    return { ok: b.code === 0, output: b.output };
  };
  // Changed since the repair began: in the working tree, or committed —
  // a worker that commits its own change has still changed the tree.
  const startHead = (await a.exec("git", ["-C", a.worktree, "rev-parse", "HEAD"], a.worktree)).out.trim();
  const changed = async (): Promise<boolean> => {
    const s = await a.exec("git", ["-C", a.worktree, "status", "--porcelain"], a.worktree);
    if (s.out.trim().length > 0) return true;
    const head = (await a.exec("git", ["-C", a.worktree, "rev-parse", "HEAD"], a.worktree)).out.trim();
    return !!startHead && !!head && head !== startHead;
  };
  const measure = async (): Promise<{ green: boolean; score: number; evidence: string; alsoOwn: string[] }> =>
    a.onTheProduct
      ? measureOnTheProduct({ build: await build(), buildCommand: a.deps.build, changed: await changed(), evidence: a.evidence })
      : suite
        ? measureTheSuite({ build: await build(), buildCommand: a.deps.build, suite: await a.suiteExec(suite, a.worktree), suiteCommand: suite })
        : measureTheBuild({ build: await build(), buildCommand: a.deps.build });
  const closed = await close({
    subject: a.onTheProduct ? `${a.tep} (what does not hold on the running product)` : `${a.tep} (what the platform refused)`,
    worktree: a.worktree,
    // Only what the platform's log named, or the files the promises land in. Nothing else is failing.
    footprint: suite ? withSharedTestSetup(a.files, a.worktree) : a.files,
    probeSources: [],
    history: [
      a.onTheProduct
        ? `the reviewers opened the running product and found these do not hold:\n${a.evidence.slice(0, 6000)}`
        : `the platform refused the merged work:\n${a.evidence.slice(0, 6000)}`,
    ],
    criteria: a.onTheProduct
      ? a.onTheProduct.criteria.map((text, i) => ({ id: `product-${i + 1}`, text }))
      : [
          {
            id: "live-1",
            text: "the platform builds and deploys this repository from what is now in the project",
          },
          ...(suite
            ? [{ id: "live-suite", text: `the repository's whole suite (${suite}) passes here, as the platform's test step runs it` }]
            : []),
        ],
    ...(a.deps.digest ? { digest: a.deps.digest } : {}),
    ...(a.deps.prepare ? { prepare: a.deps.prepare } : {}),
    model: a.deps.model,
    ...(a.deps.workerModel ? { workerModel: a.deps.workerModel } : {}),
    measure,
    exec: a.exec,
    boundedExec: a.boundedExec,
    halted: () => a.st.halted,
    abortable: (ab) => a.st.aborts.set(step, ab),
    log: a.log,
    say: (t) => a.st.doing(step, t),
    onRuling: () => {},
    defect: () => {},
    ...(a.deps.worker ? { worker: a.deps.worker } : {}),
  });
  if (closed.green) {
    await stageWork({ worktree: a.worktree, exec: a.exec, log: a.log });
    await a.exec(
      "git",
      ["-C", a.worktree, "commit", "-m", `tandem: ${a.tep} — what the platform refused (attempt ${a.attempt})`],
      a.worktree,
    );
  }
  return { green: closed.green, report: closed.report };
}

/** The build is the measure of a repair the platform's refusal asked for. */
export function measureTheBuild(a: {
  build: { ok: boolean; output: string };
  buildCommand?: string;
}): { green: boolean; score: number; evidence: string; alsoOwn: string[] } {
  return {
    green: a.build.ok,
    score: a.build.ok ? 0 : 1,
    evidence: a.build.ok
      ? "the build passes here"
      : `THE PRODUCT BUILD FAILS HERE (${a.buildCommand ?? "build"}):\n${a.build.output.slice(-6000)}`,
    alsoOwn: [],
  };
}

/** The whole suite is the measure of a repair of the pipeline's test step:
 *  it is what that step runs. Green only when the build and the suite pass. */
export function measureTheSuite(a: {
  build: { ok: boolean; output: string };
  buildCommand?: string;
  suite: { code: number | null; output: string };
  suiteCommand: string;
}): { green: boolean; score: number; evidence: string; alsoOwn: string[] } {
  if (!a.build.ok) return measureTheBuild(a);
  const green = a.suite.code === 0;
  return {
    green,
    score: green ? 0 : 1,
    evidence: green
      ? `the build and the whole suite (${a.suiteCommand}) pass here`
      : `THE WHOLE SUITE FAILS HERE (${a.suiteCommand}, exit ${a.suite.code ?? "null"}) — the platform's test step runs it:\n${a.suite.output.slice(-6000)}`,
    alsoOwn: [],
  };
}

/** Shared test setup a test directory's tests load before they run. */
const SHARED_TEST_SETUP = ["conftest.py"];

/**
 * The files a repair of the test step may edit: the ones the log named,
 * and the shared test setup in the directory of each named test file,
 * where it exists.
 */
export function withSharedTestSetup(files: string[], worktree: string): string[] {
  const out = new Set(files);
  for (const f of files) {
    if (!isTestPath(f)) continue;
    for (const name of SHARED_TEST_SETUP) {
      const rel = path.posix.join(path.posix.dirname(f), name);
      if (fs.existsSync(path.join(worktree, rel))) out.add(rel);
    }
  }
  return [...out];
}

/**
 * The measure of a repair the reviewers asked for. The build already
 * passed when they looked, so the build alone would call an untouched
 * tree green and the closer would stop before its first round. Red until
 * the tree has changed and builds; whether the change is right is the
 * reviewers' to say, on the product, afterwards.
 */
export function measureOnTheProduct(a: {
  build: { ok: boolean; output: string };
  buildCommand?: string;
  changed: boolean;
  evidence: string;
}): { green: boolean; score: number; evidence: string; alsoOwn: string[] } {
  if (!a.changed)
    return {
      green: false,
      score: 1,
      evidence: `THE REVIEWERS FOUND THESE DO NOT HOLD ON THE RUNNING PRODUCT, and nothing in the tree has changed yet — the code must change in the files named:\n${a.evidence.slice(0, 6000)}`,
      alsoOwn: [],
    };
  if (!a.build.ok)
    return {
      green: false,
      score: 1,
      evidence: `THE PRODUCT BUILD FAILS HERE (${a.buildCommand ?? "build"}):\n${a.build.output.slice(-6000)}`,
      alsoOwn: [],
    };
  return { green: true, score: 0, evidence: "the tree changed and the build passes here — the reviewers judge the rest", alsoOwn: [] };
}
