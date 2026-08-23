/**
 * The run's plan-side bookkeeping: execution locks, per-slice probe and
 * test-home maps, the closing gate's verification list, the honesty scan,
 * the delivery record, documentation obligations, and the roles' invariant
 * (no coder holds a test-shaped path).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SliceForDag } from "../engine/core/dag";
import type { AcVerification } from "../engine/orchestratorCore";
import { buildVerificationTrace } from "../engine/core/trace";
import { unmetDocsObligation } from "../engine/core/redispatch";
import { accessSync, readFileSync } from "node:fs";
import type { Proof } from "../core/schema";
import { isDocPath } from "../core/docs";
import { isProbePath, isTestPath } from "./testHomes";
import { waitReasons } from "./fence";
import type { RunState } from "./state";
import type { Exec } from "./oracle";
import * as fsp from "node:fs/promises";

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
 * How to run one check when the door proved no command for this repository.
 *
 * A source a runtime cannot load is not a check: it fails identically
 * whatever the product does, so it can never report the criterion it was
 * written for. A TypeScript check therefore names the compiled twin its
 * build emits — `src/x_AC-1.test.ts` is run as `out-test/x_AC-1.test.js` —
 * and the caller is expected to have run the build. Any other path is run
 * where it sits, which is what a no-build repository needs.
 *
 * This is a last resort, not a shape: the proved `runOne` always wins.
 */
function defaultRunOne(probe: string): string {
  return `node --test ${builtTwin(probe)}`;
}

/**
 * The path a check is actually loadable at: a TypeScript check names the
 * compiled twin its build emits (`src/x_AC-1.test.ts` → `out-test/x_AC-1.test.js`),
 * anything else stays where it sits.
 */
function builtTwin(probe: string): string {
  return /\.tsx?$/.test(probe)
    ? probe.replace(/^src\//, "out-test/").replace(/\.tsx?$/, ".js")
    : probe;
}

/**
 * A proved `runOne` wins on HOW a test is invoked, but never on whether the
 * path it names can be loaded. A template that substitutes `<file>` without
 * remapping TypeScript yields `node --test src/x_AC-1.test.ts`, which fails
 * identically whatever the product does — reporting nothing about the
 * criterion. When the template leaves a TypeScript path unmapped, the
 * compiled twin is substituted instead.
 */
function runOneFor(runOne: string, probe: string): string {
  if (!runOne) return defaultRunOne(probe);
  const substituted = runOne.replace(/<file>/g, probe);
  if (!/\.tsx?$/.test(probe)) return substituted;
  // The template already remaps to built output: trust it as proved.
  if (!/(^|[\s"'])[^\s"']*\.tsx?([\s"']|$)/.test(substituted)) return substituted;
  return runOne.replace(/<file>/g, builtTwin(probe));
}

/**
 * Per-slice bookkeeping: its probe files, the verification each one stands
 * for, and the paths its commit will stage. The ordinal a check is known by
 * downstream is this list's ORDER — the probe filenames carry the same
 * number, which is what lets a failing check be traced back to its source.
 */
export function sliceBookkeeping(
  slices: SliceForDag[],
  /** How this repository runs one of its own tests (`<file>` = its path),
   *  proved at the door. A check is run the way the repository runs a test,
   *  not the way one language does. */
  runOne = "",
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
      probes.map((p, i) => ({ ac: acOf(p) || i + 1, run: runOneFor(runOne, p), env: "local" })),
    );
    sliceFiles.set(s.handle, s.files ?? []);
  }
  // A maintain slice is checked by its parent's probes: the tree it leaves
  // must build and keep the parent's promises green.
  const rehomed: { parent: string; maintainer: string; ac: number; check: string }[] = [];
  for (const s of slices) {
    const parent = (s as { maintains?: string }).maintains;
    if (parent && sliceProbes.has(parent)) {
      sliceProbes.set(s.handle, sliceProbes.get(parent)!);
      sliceVerifs.set(s.handle, sliceVerifs.get(parent)!);
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
 *
 * Each probe is run the same way a single check is run, so a TypeScript
 * probe names the compiled twin its build emits rather than a source no
 * runtime can load.
 */
export function closingVerifications(slices: SliceForDag[]): {
  verifs: AcVerification[];
  probeOfAc: Map<number, string>;
} {
  const verifs: AcVerification[] = [];
  const probeOfAc = new Map<number, string>();
  let ord = 0;
  for (const s of slices)
    for (const u of s.workUnits.filter((x) => x.role === "test"))
      for (const probe of u.footprint.filter(isProbePath)) {
        verifs.push({ ac: ++ord, run: defaultRunOne(probe), env: "local" });
        probeOfAc.set(ord, probe);
      }
  return { verifs, probeOfAc };
}

/**
 * The honesty scan over the delivered code: every file the run created or
 * changed, read for self-declared deferrals. A confession in a shipped
 * file is UNDELIVERED on the delivery's face, never a footnote.
 */
/** The word "undelivered" is this codebase's own vocabulary — a field, a
 *  list, a doc line about the mechanism. A confession is the marker in its
 *  form, `UNDELIVERED:` in capitals, or another marker word; the vocabulary
 *  alone is not a deferral. */
const OTHER_MARKERS = /\b(TODO|FIXME|XXX|HACK|not in scope|not implemented|unimplemented|pending SDK)\b/i;
function isDeferralVocabulary(text: string): boolean {
  return !OTHER_MARKERS.test(text) && !/\bUNDELIVERED\s*:/.test(text);
}

export async function confessedDeferrals(args: {
  worktree: string;
  baseSha: string;
  exec: Exec;
  extraPaths: string[];
  onHit: (file: string, line: number, text: string) => void;
}): Promise<string[]> {
  const { isStubScannableFile, scanStubMarkers } = await import("../engine/core/stubScan");
  const out: string[] = [];
  const delivered = (
    await args.exec(
      "git",
      ["-C", args.worktree, "diff", "--name-only", "--diff-filter=d", `${args.baseSha}..HEAD`],
      args.worktree,
    )
  ).out
    .split("\n")
    .concat(args.extraPaths)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const rel of [...new Set(delivered)]) {
    if (!isStubScannableFile(rel)) continue;
    let content = "";
    try {
      content = await fs.readFile(path.join(args.worktree, rel), "utf8");
    } catch {
      continue;
    }
    for (const h of scanStubMarkers(rel, content).filter((x) => !x.weak && !isDeferralVocabulary(x.text))) {
      out.push(`${h.file}:${h.line} confesses a deferral: ${h.text}`);
      args.onHit(h.file, h.line, h.text);
    }
  }
  return out;
}


/**
 * The delivery's MACHINE FACE persists beside the space: the engine's
 * structured verification trace plus the run facts — the delivery page is
 * a render, this file is the evidence record. Best-effort: the run's
 * verdicts already live on the delivery.
 */
export async function writeDeliveryRecord(
  storeDir: string,
  record: {
    tep: string;
    branch: string;
    baseSha: string;
    proofs: Proof[];
    undelivered: string[];
    verifs: AcVerification[];
    acResults: Parameters<typeof buildVerificationTrace>[0]["acResults"];
    /** The checks themselves — kept here because the files are discarded. */
    checks?: KeptCheck[];
    /** Attention events about the machine in this run. Target: zero. */
    machineAttention?: number;
  },
): Promise<void> {
  try {
    const trace = buildVerificationTrace({
      round: 1,
      declared: record.verifs,
      acResults: record.acResults,
    });
    const dir = path.join(storeDir, "deliveries");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, `${record.tep}.json`),
      JSON.stringify(
        {
          tep: record.tep,
          branch: record.branch,
          baseSha: record.baseSha,
          proofs: record.proofs,
          undelivered: record.undelivered,
          trace,
          ...(record.checks?.length ? { checks: record.checks } : {}),
          machineAttention: record.machineAttention ?? 0,
        },
        null,
        2,
      ),
    );
  } catch {
    /* best-effort */
  }
}

/** A check whose file leaves the tree: what it proved, and its source. */
/**
 * Put a delivery's recorded checks back into a tree.
 *
 * A delivery consumes its checks — the sources live on the record, the
 * files leave the tree. A run of the same cut after that (the person ran
 * it again, or the acceptance loop proves it three times) finds standing
 * testers and no check files, which once turned a fully-delivered cut into
 * sixty-four file-not-found reds. What the record kept is written back,
 * and only where nothing else has since claimed the path.
 */
/** The check paths a cut's delivery record holds, or nothing. */
export function recordedCheckPaths(storeDir: string, tep: string): string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(storeDir, "deliveries", `${tep}.json`), "utf8"),
    ) as { checks?: { path?: string }[] };
    return (parsed.checks ?? []).map((c) => c.path).filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

export async function restoreChecksFromRecord(
  storeDir: string,
  tep: string,
  worktree: string,
  wanted: readonly string[],
): Promise<string[]> {
  let checks: KeptCheck[];
  try {
    const raw = await fsp.readFile(path.join(storeDir, "deliveries", `${tep}.json`), "utf8");
    checks = (JSON.parse(raw) as { checks?: KeptCheck[] }).checks ?? [];
  } catch {
    return [];
  }
  const restored: string[] = [];
  for (const rel of wanted) {
    const kept = checks.find((c) => c.path === rel);
    if (!kept) continue;
    const dst = path.join(worktree, rel);
    if (await fsp.access(dst).then(() => true, () => false)) continue;
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.writeFile(dst, kept.source);
    restored.push(rel);
  }
  return restored;
}

export interface KeptCheck {
  criterionId: string;
  /** Where the check lived while the run drove it. */
  path: string;
  source: string;
}

/**
 * Read the run's checks out of the tree so the delivery can carry them.
 *
 * A check that cannot be read is dropped rather than recorded empty: an
 * empty source on the record would read as "this criterion was proven by
 * nothing", which is worse than its absence.
 */
export async function keptChecks(
  probes: readonly string[],
  worktree: string,
  criterionByProbe: ReadonlyMap<string, string>,
): Promise<KeptCheck[]> {
  const out: KeptCheck[] = [];
  for (const rel of [...new Set(probes)]) {
    const criterionId = criterionByProbe.get(rel);
    if (!criterionId) continue;
    const source = await fsp.readFile(path.join(worktree, rel), "utf8").catch(() => undefined);
    if (source !== undefined) out.push({ criterionId, path: rel, source });
  }
  return out;
}


/** Docs gate: a slice that declares documentation (a docs/ touchpoint)
 *  must have LANDED it — the engine's obligation check runs against the
 *  real tree, and an unmet obligation is UNDELIVERED on the page's face. */
export function docsObligations(slices: SliceForDag[], worktree: string): string[] {
  const out: string[] = [];
  for (const s of slices) {
    const declaresDocs = (s.files ?? []).some(isDocPath);
    const note = unmetDocsObligation(
      {
        docs: declaresDocs ? "required" : undefined,
        files: s.files,
        work_units: s.workUnits,
      },
      (rel) => {
        try {
          accessSync(path.join(worktree, rel));
          return true;
        } catch {
          return false;
        }
      },
    );
    if (note) out.push(`${s.handle}: ${note}`);
  }
  return out;
}

/** A code-role unit whose whole footprint is test homes: the slice's
 *  maintainer, worked and briefed as a tester. */
export function isMaintainUnit(u: { role?: string; footprint: readonly string[] }): boolean {
  return (u.role ?? "code") === "code" && u.footprint.length > 0 && u.footprint.every((p) => isTestPath(p) && !isProbePath(p));
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
    .filter((x) => (x as { maintains?: string }).maintains && x.handle !== slice)
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
