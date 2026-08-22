/**
 * What a run needs from whoever starts it: the repository, the models, the
 * commands this repository answers to, and the seams a test replaces.
 *
 * It lives apart from the loop because it is a contract, read by the
 * editor, the headless entry and every test — while the loop beside it is
 * a program.
 */
import type { Forge } from "../dispatch/forge";
import type { RunState } from "./state";
import type { WorkerModelConfig } from "../engine/workerModel";
import type { runUnitWorker, WorkerOutcome } from "./worker";
import type { runReadRound } from "../derive/round";
import type { OracleFactoryArgs } from "./oracle";

export interface DispatchDeps {
  repoRoot: string;
  model: string;
  /** Per-role model resolution (judgment raised above the base). */
  workerModel?: WorkerModelConfig;
  suiteCommand: string[];
  forge?: Forge;
  state: RunState;
  spaceName: string;
  /** Project identity — qualifies branch and worktree names so two
   *  projects' runs in the same monorepo never collide (§7quater). */
  projectId?: string;
  /** The store dir for find-time defect rows (fail-soft; absent = no ledger). */
  storeDir?: string;
  /** The repository reading (conventions and the why) — every worker gets it in its brief:
   *  workers are the only actors that MAKE changes, so they must see what a change must respect. */
  digest?: string;
  /** How this repository's probes are written and run — a fact about the target repository;
   *  the default fits the node harness the oracle ships with. */
  testConvention?: string;
  /** What a fresh checkout needs installed — run once; its produce is linked into every runner. */
  provision?: string;
  /** How ONE of the repository's own tests runs (`<file>` = its path) — proved at setup. */
  runOne?: string;
  /** Test files red at an earlier gate — run early at every slice; told what stayed red at this one. */
  suiteReds?: readonly string[];
  rememberSuiteReds?: (files: readonly string[]) => void;
  /** Re-read the setup facts from a failure's evidence (the door tries the correction once). */
  resetup?: (evidence: string) => Promise<{ provision: string; prepare: string; runOne?: string }>;
  /** The door proved this setup on the untouched tree — remember it as the answer. */
  proveSetup?: (s: { provision: string; prepare: string; runOne: string }) => void;
  /** The code graph's importer listing for a path — orders each slice's
   *  test-home work after the production code those tests import. */
  affected?: (path: string) => Promise<string>;
  /** Build/typecheck command run in the verify runner and the gate
   *  worktree before checks — the engine's own prepare seam. */
  prepare?: string;
  /** Concurrent workers on the ready frontier (default 4, the v1 default). */
  concurrency?: number;
  /** Injectable for tests: how a unit sleeps waiting for another unit's
   *  commit — a wait nothing can fast-forward is a wait no test can reach. */
  waitSleep?: (ms: number, wake: (fn: () => void) => void) => Promise<void>;
  /** Injectable for tests: replaces the SDK worker. */
  worker?: (
    deps: Parameters<typeof runUnitWorker>[0],
    brief: string,
  ) => Promise<WorkerOutcome>;
  /** Injectable for tests: replaces the supervisor's SDK round. */
  supervisorRound?: typeof runReadRound;
  /** Injectable for tests: replaces the check re-author (challenge and repair). */
  author?: OracleFactoryArgs["author"];
  exec?: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
}

