/**
 * What a run needs from whoever starts it: the repository, the models, the
 * commands this repository answers to, and the seams a test replaces.
 *
 * It lives apart from the loop because it is a contract, read by the
 * editor, the journey entry and every test — while the loop beside it is
 * a program.
 */
import type { Forge } from "../dispatch/forge";
import type { RunState } from "./state";
import type { WorkerModelConfig } from "../engine/workerModel";
import type { runUnitWorker, WorkerOutcome } from "./worker";
import type { runReadRound } from "../derive/round";
import type { OracleFactoryArgs } from "./oracle";
import type { Proved } from "./proved";

export interface DispatchDeps {
  repoRoot: string;
  model: string;
  /** Per-role model resolution (judgment raised above the base). */
  workerModel?: WorkerModelConfig;
  /**
   * What SOMEBODY TOLD the run about this repository — a setting, a
   * remembered file, a reading. Candidates, never trusted: the door runs
   * each one here and only what answers becomes a {@link Proved} below.
   * Kept apart from the proved fields so a candidate cannot reach an
   * executor: that is how `npm test` was run in a repository with no npm,
   * and how the shell's "command not found" became a verdict on the work.
   */
  told?: {
    provision?: string;
    prepare?: string;
    runOne?: string;
    build?: string;
    suite?: string;
  };
  forge?: Forge;
  state: RunState;
  spaceName: string;
  /** Project identity — qualifies branch and worktree names so two
   *  projects' runs in the same monorepo never collide (§7quater). */
  projectId?: string;
  /** Start this cut from nothing: discard the branch an earlier run left,
   *  so every unit runs again on the base as it stands today. */
  freshStart?: boolean;
  /** The store dir for find-time defect rows (fail-soft; absent = no ledger). */
  storeDir?: string;
  /** The repository reading (conventions and the why) — every worker gets it in its brief:
   *  workers are the only actors that MAKE changes, so they must see what a change must respect. */
  digest?: string;
  /** How this repository's probes are written and run — a fact about the target repository;
   *  the default fits the node harness the oracle ships with. */
  testConvention?: string;
  /** Proved at the door: what a fresh checkout needs installed. Its produce is linked into every runner. */
  provision?: Proved;
  /** Proved at the door: how ONE of this repository's tests runs (`<file>` = its path). */
  runOne?: Proved;
  /** Test files red at an earlier gate — run early at every slice; told what stayed red at this one. */
  suiteReds?: readonly string[];
  rememberSuiteReds?: (files: readonly string[]) => void;
  /** Re-read the setup facts from a failure's evidence (the door tries the correction once). */
  resetup?: (
    evidence: string,
  ) => Promise<{ provision: string; prepare: string; runOne?: string; suite?: string }>;
  /** The door proved this setup on the untouched tree — remember it as the answer. */
  proveSetup?: (s: { provision: string; prepare: string; runOne: string }) => void;
  /** The code graph's importer listing for a path — orders each slice's
   *  test-home work after the production code those tests import. */
  affected?: (path: string) => Promise<string>;
  /** Build/typecheck command run in the verify runner and the gate
   *  worktree before checks — the engine's own prepare seam. */
  prepare?: Proved;
  /** Proved at the door: builds the PRODUCT as this repository ships it.
   *  Red at the gate withholds the delivery. */
  build?: Proved;
  /** Proved at the door: runs this repository's WHOLE suite. The closing
   *  gate's last judgement is this command's verdict, so a run without one
   *  is refused at the door rather than judging with nothing. */
  suite?: Proved;
  /** Concurrent workers on the ready frontier (default 4, the v1 default). */
  concurrency?: number;
  /** Injectable for tests: how a unit sleeps waiting for another unit's
   *  commit — a wait nothing can fast-forward is a wait no test can reach. */
  waitSleep?: (ms: number, wake: (fn: () => void) => void) => Promise<void>;
  /** How long this run may take before it stops and reports (ms). */
  maxRunMs?: number;
  /** The code map, so a criterion pitched at a class is refused before any
   *  worker starts (src/run/altitude.ts). */
  graphPath?: string;
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
  /** Injectable for tests: the run's own clock (epoch ms). One reading of
   *  it mints both the run id and the produced-at stamp on its delivery, so
   *  the two can never name different moments. Defaults to `Date.now`. */
  now?: () => number;
}

