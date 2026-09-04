/**
 * The run's plan-side bookkeeping: execution locks, per-slice probe and
 * test-home maps, the closing gate's verification list, and the roles'
 * invariant (no coder holds a test-shaped path). The honesty scan, the
 * delivery record and documentation obligations live in ./planDelivery,
 * re-exported here so existing callers keep reading from this module.
 */
import * as path from "node:path";
import type { SliceForDag } from "../engine/core/dag";
import type { AcVerification } from "../engine/orchestratorCore";
import { isProbePath, isTestPath, missingProbes } from "./testHomes";
import { waitReasons } from "./fence";
import type { RunState } from "./state";
import * as fsp from "node:fs/promises";
import type { Proved } from "./proved";

export { confessedDeferrals, writeDeliveryRecord, keptChecks, docsObligations } from "./planDelivery";
export type { KeptCheck } from "./planDelivery";

/**
 * How to run ONE check, for the part that owns it.
 *
 * A repository is often several toolchains — a python backend beside a
 * node frontend — and one command runs the wrong runner for every part
 * but one. The check's own path decides which command it gets; the caller
 * knows the parts, so it answers.
 */
export type RunnerFor = (checkPath: string) => Proved;

/**
 * Execution locks (§multi-user commitment 4): a machine-local lock file per
 * in-flight run on a repository. A new dispatch whose footprints intersect
 * an in-flight run's — including a DIFFERENT project's in the same
 * monorepo — refuses with the collision named. Best-effort bookkeeping; the
 * forge branch claim stays the hard mutex.
 *
 * A lock is only as alive as the process that wrote it. The unlock runs in
 * the dispatcher's finally, so a window reload or a crash mid-run leaves
 * the file behind with nobody to remove it — and "stop that run first" is
 * an instruction no gesture can follow for a run that no longer exists.
 * Every lock therefore carries its writer's pid, and a colliding lock
 * whose process is gone is STALE: removed, said, and stepped over.
 */
export async function claimRunLock(
  wtRoot: string,
  wtName: string,
  runName: string,
  slices: SliceForDag[],
  opts?: {
    log?: (line: string) => void;
    /** Injectable for tests: is this pid a live process on this machine? */
    alive?: (pid: number) => boolean;
  },
): Promise<{ refusal?: string; unlock: () => Promise<void> }> {
  const alive =
    opts?.alive ??
    ((pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  const locksDir = path.join(wtRoot, "locks");
  const myFootprints = slices.flatMap((s) => [
    ...(s.files ?? []),
    ...s.workUnits.flatMap((u) => u.footprint),
  ]);
  const lockFile = path.join(locksDir, `${wtName}.json`);
  const unlock = async (): Promise<void> => {
    await fsp.rm(lockFile, { force: true }).catch(() => {});
  };
  try {
    await fsp.mkdir(locksDir, { recursive: true });
    for (const f of await fsp.readdir(locksDir)) {
      if (!f.endsWith(".json") || f === `${wtName}.json`) continue;
      try {
        const other = JSON.parse(await fsp.readFile(path.join(locksDir, f), "utf8")) as {
          runName?: string;
          footprints?: string[];
          pid?: number;
        };
        const overlap = (other.footprints ?? []).filter((p) =>
          myFootprints.some((m) => m === p || m.startsWith(p + "/") || p.startsWith(m + "/")),
        );
        if (!overlap.length) continue;
        // A lock without a pid predates liveness and cannot be verified;
        // it is treated as stale the same way — the branch claim guards.
        if (!other.pid || !alive(other.pid)) {
          await fsp.rm(path.join(locksDir, f), { force: true }).catch(() => {});
          opts?.log?.(
            `a lock from ${other.runName ?? f} was left by a process that is gone — cleared, not obeyed`,
          );
          continue;
        }
        return {
          refusal: `dispatch refused: footprints collide with in-flight run ${other.runName ?? f} on this repository (${[...new Set(overlap)].slice(0, 5).join(", ")}) — accept or stop that run first`,
          unlock: async () => {},
        };
      } catch {
        /* an unreadable lock never blocks — the branch claim still guards */
      }
    }
    await fsp.writeFile(
      lockFile,
      JSON.stringify({ runName, footprints: myFootprints, pid: process.pid }),
    );
  } catch {
    /* lock bookkeeping is best-effort; the branch claim is the hard mutex */
  }
  return { unlock };
}

/**
 * Per-slice bookkeeping: its probe files, the verification each one stands
 * for, and the paths its commit will stage. The ordinal a check is known by
 * downstream is this list's ORDER — the probe filenames carry the same
 * number, which is what lets a failing check be traced back to its source.
 */
export function sliceBookkeeping(
  slices: SliceForDag[],
  /**
   * How this repository runs one of its own tests (`<file>` = its path),
   * PROVED at the door.
   *
   * Required, and branded, because the alternative was written here: a
   * check with no proved command fell back to `node --test <probe>`. In a
   * repository that is not JavaScript that command does not exist, the
   * check cannot run, a check that cannot run is red, and a red check is
   * an unkept promise. The machine's ignorance was reported as the
   * person's work failing.
   */
  runOne: RunnerFor,
): {
  sliceProbes: Map<string, string[]>;
  sliceVerifs: Map<string, AcVerification[]>;
  sliceFiles: Map<string, string[]>;
  /** What each probe is FOR, in the check's own words — so a result is
   *  reported as the check the human read on the card. */
  checkOf: Map<string, string>;
  /** Checks homed on the maintainer at planning: the criterion names a test
   *  home the maintain slice brings under, so the parent's coder is never
   *  graded on a file its runner prunes. */
  rehomed: { parent: string; maintainer: string; ac: number; check: string }[];
} {
  const sliceProbes = new Map<string, string[]>();
  const sliceVerifs = new Map<string, AcVerification[]>();
  const sliceFiles = new Map<string, string[]>();
  const checkOf = new Map<string, string>();
  for (const s of slices) {
    const tests = s.workUnits.filter((u) => u.role === "test");
    for (const u of tests) {
      // The note a probe was written from is "[the promise] the check".
      const said = (u as { note?: string }).note ?? "";
      const check = said.replace(/^\[[^\]]*\]\s*/, "").trim();
      for (const f of u.footprint) if (check && isProbePath(f)) checkOf.set(f, check);
    }
    const probes = tests.flatMap((u) => u.footprint).filter(isProbePath);
    sliceProbes.set(s.handle, probes);
    sliceVerifs.set(
      s.handle,
      // The ordinal comes from the probe's own name, so a list a later rule
      // filters still names the right check.
      probes.map((p, i) => ({ ac: acOf(p) || i + 1, run: runOne(p).replace(/<file>/g, p), env: "local" })),
    );
    sliceFiles.set(s.handle, s.files ?? []);
  }
  // A maintain slice is checked by its parent's probes: the tree it leaves
  // must build and keep the parent's promises green.
  const rehomed: { parent: string; maintainer: string; ac: number; check: string }[] = [];
  for (const s of slices) {
    const parents = ((s as { maintains?: string[] }).maintains ?? []).filter((p) => sliceProbes.has(p));
    if (parents.length) {
      const parent = parents[0];
      // Every promise this file serves: the tree it leaves must keep all
      // of them green, not only the first one's.
      sliceProbes.set(s.handle, [...new Set(parents.flatMap((p) => sliceProbes.get(p)!))]);
      sliceVerifs.set(s.handle, parents.flatMap((p) => sliceVerifs.get(p)!));
      // A check whose words name one of this maintainer's test homes is the
      // maintainer's to prove — the parent's runner prunes those very files.
      const homes = s.workUnits.filter(isMaintainUnit).flatMap((u) => u.footprint);
      const theirs = (probe: string) => {
        const check = checkOf.get(probe) ?? "";
        return homes.some((h) => check.includes(h) || check.includes(h.split("/").pop() ?? h));
      };
      const moved = (sliceProbes.get(parent) ?? []).filter(theirs);
      if (moved.length) {
        for (const probe of moved)
          rehomed.push({ parent, maintainer: s.handle, ac: acOf(probe), check: checkOf.get(probe) ?? probe });
        // Only the GRADING moves: the parent keeps the probe FILES, so they
        // ride its commit and survive for the maintainer that grades them.
        sliceVerifs.set(parent, (sliceVerifs.get(parent) ?? []).filter((v) => !moved.some((p) => v.run.includes(p))));
      }
    }
  }
  return { sliceProbes, sliceVerifs, sliceFiles, checkOf, rehomed };
}

/** The check ordinal a probe file carries in its name. */
function acOf(probe: string): number {
  const m = /_AC-(\d+)\./.exec(probe);
  return m ? Number(m[1]) : 0;
}

/**
 * The closing gate's verification list: every probe the run authored, in
 * slice order, each with the ordinal the gate knows it by — and the way
 * back from that ordinal to the probe, so a result can be reported as the
 * check it ran rather than as its position in a list.
 */
export function closingVerifications(
  slices: SliceForDag[],
  /** How this repository runs ONE of its own tests (`<file>` = its path),
   *  PROVED at the door. The gate ran a hardcoded `node --test <path>`
   *  instead, so a repository whose tests are compiled first — or whose
   *  sources are not what its runner takes — had every check fail here
   *  after passing in its own slice, identically, for a reason no worker
   *  could act on. Ten promises were withheld exactly that way. */
  runOne: RunnerFor,
): {
  verifs: AcVerification[];
  probeOfAc: Map<number, string>;
} {
  const verifs: AcVerification[] = [];
  const probeOfAc = new Map<number, string>();
  let ord = 0;
  for (const s of slices)
    for (const u of s.workUnits.filter((x) => x.role === "test"))
      for (const probe of u.footprint.filter(isProbePath)) {
        verifs.push({
          ac: ++ord,
          run: runOne(probe).replace(/<file>/g, probe),
          env: "local",
        });
        probeOfAc.set(ord, probe);
      }
  return { verifs, probeOfAc };
}

/**
 * A code-role unit whose whole footprint is test-shaped: the slice's
 * maintainer, worked and briefed as a tester.
 *
 * A check born in the repository's own idiom is named `<stem>_AC-<k>`, so
 * it answers to `isProbePath` as well as `isTestPath` — a maintainer that
 * brings one standing test under the criteria alongside one new check owns
 * both shapes at once. Requiring every path to be a test that is NOT a
 * probe therefore read such a unit as a coder: the plan refused itself
 * before dispatch, and had it passed, the unit would have been briefed as
 * a coder and then refused again for reading a check.
 *
 * The tester is separated by its ROLE, never by the shape of its paths.
 */
export function isMaintainUnit(u: { role?: string; footprint: readonly string[] }): boolean {
  return (u.role ?? "code") === "code" && u.footprint.length > 0 && u.footprint.every((p) => isTestPath(p));
}

/** The plan's role invariant: no coder holds a test-shaped path (a
 *  maintainer holds nothing else). Returns the offending "unit: path"
 *  pairs — a plan that breaks the roles is refused before any worker starts. */
export function coderTestPaths(slices: SliceForDag[]): string[] {
  const out: string[] = [];
  for (const s of slices)
    s.workUnits
      .filter((u) => (u.role ?? "code") === "code" && !isMaintainUnit(u))
      .forEach((u, k) => {
        for (const p of u.footprint)
          if (isTestPath(p)) out.push(`${s.handle}#eu-${k}: ${p}`);
      });
  return out;
}

/** Production files that units not yet done will still write or create: a
 *  build missing one of them is the tree not being ready, never the failure
 *  of the unit that saw it. */
export function plannedByPending(
  dag: readonly { id: string; role?: string; footprint: string[] }[],
  done: ReadonlySet<string>,
): string[] {
  return dag
    .filter((u) => !done.has(u.id) && (u.role ?? "code") === "code" && !isMaintainUnit(u))
    .flatMap((u) => u.footprint);
}

/** Every test home a maintainer OTHER than this slice will bring under: out
 *  of this slice's runner build until that maintainer runs — a coder's
 *  change that breaks or retires an old test is never the coder's failure,
 *  and a maintainer sees only its own homes. */
export function maintainedElsewhere(slices: readonly SliceForDag[], slice: string): string[] {
  return slices
    .filter((x) => (x as { maintains?: string[] }).maintains?.length && x.handle !== slice)
    .flatMap((x) => x.files ?? []);
}

/**
 * Seed the surface's view of every unit: its role, what it waits on, and
 * WHY it waits per edge. Two very different things live in `requires` — a
 * cross-slice dependency, and the same-slice rule that a coder starts once
 * its checks exist — and drawn as one arrow they read alike.
 */
export function seedUnitViews(
  st: RunState,
  dag: readonly { id: string; slice: string; role?: string; requires: string[]; note?: string; footprint: string[] }[],
  slices: readonly { handle: string; workUnits: { consumes?: string[] }[] }[],
): void {
  const whyWait = waitReasons(dag as never, slices as never);
  for (const u of dag) {
    const requires = u.requires.filter((r) => dag.some((x) => x.id === r));
    const why = requires.map((r) => whyWait(u, r));
    st.seed(u.id, u.slice, isMaintainUnit(u) ? "maintain" : ((u.role ?? "code") as "code" | "test"), requires, u.note, why);
  }
}

/**
 * Which slices an earlier run of this cut left standing.
 *
 * A slice an earlier run finished is done on the record and nothing
 * re-runs it; the gate re-proves it like all work. Two accounts of that,
 * because each is silent where the other speaks: a commit proves a slice
 * ran AND changed something, and says nothing about one that found its
 * work already done — read from commits alone, such a slice starts again
 * on every resume and finds the same nothing to do. The run's own record
 * says which units it finished, which is the fact wanted.
 *
 * Either way it stands only if it satisfies THIS plan, which may have grown
 * since: what this plan asks for is on disk, or the slice runs again.
 */
export async function standingSlices(
  committed: readonly { slice: string; runId?: string }[],
  dag: readonly { slice: string; footprint: string[] }[],
  worktree: string,
  log: (line: string) => void,
  /** Slices an earlier run of this cut RECORDED finishing. */
  finished: readonly string[] = [],
): Promise<Set<string>> {
  const inPlan = (sl: string): boolean => dag.some((u) => u.slice === sl);
  const standing = new Set([
    ...committed.filter((c) => inPlan(c.slice)).map((c) => c.slice),
    ...finished.filter(inPlan),
  ]);
  for (const sl of finished)
    if (standing.has(sl) && !committed.some((c) => c.slice === sl))
      log(`${sl} committed nothing, and an earlier run recorded finishing it — it stands`);
  for (const sl of [...standing]) {
    const owes = await missingProbes(worktree, dag.filter((u) => u.slice === sl).flatMap((u) => u.footprint));
    if (!owes.length) continue;
    standing.delete(sl);
    log(`${sl} was left standing by an earlier run, but this plan asks for ${owes.length} check(s) it never wrote — it runs again`);
  }
  return standing;
}

/**
 * The line a unit's own log carries when it passes because an earlier run
 * already did the work: naming that earlier run when the slice commit that
 * made it standing carried one, and saying plainly that no such run is on
 * the record when it did not — never inventing a run id to fill the gap.
 */
export function standingPassLine(unitId: string, slice: string, ranIn?: string): string {
  if (ranIn)
    return `✓ ${unitId}: ${slice} was standing from an earlier run — it passed in ${ranIn}, not in this run.`;
  return `✓ ${unitId}: ${slice} was standing from an earlier run, but that earlier run is not on the record — its commit named no run.`;
}
