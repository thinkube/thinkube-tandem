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
import { isDocumentationPath } from "../core/cutClosure";
import { accessSync } from "node:fs";
import { isProbePath, isTestPath, missingProbes } from "./testHomes";
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
      probes.map((p, i) => ({ ac: acOf(p) || i + 1, run: runOne ? runOne.replace(/<file>/g, p) : `node --test ${p}`, env: "local" })),
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
 */
export function closingVerifications(
  slices: SliceForDag[],
  /** How this repository runs ONE of its own tests (`<file>` = its path),
   *  proved at the door. The gate ran a hardcoded `node --test <path>`
   *  instead, so a repository whose tests are compiled first — or whose
   *  sources are not what its runner takes — had every check fail here
   *  after passing in its own slice, identically, for a reason no worker
   *  could act on. Ten promises were withheld exactly that way. */
  runOne = "",
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
          run: runOne ? runOne.replace(/<file>/g, probe) : `node --test ${probe}`,
          env: "local",
        });
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

/**
 * The lines this run ADDED, per file, with the line number they landed on.
 *
 * Read from the diff git already has, so nothing has to judge whether a
 * marker word means what it says: a line that was in the tree before is
 * not this work's confession, whoever wrote it and why.
 */
async function addedLines(
  worktree: string,
  baseSha: string,
  exec: Exec,
): Promise<Map<string, Map<number, string>>> {
  const out = new Map<string, Map<number, string>>();
  const diff = (
    await exec("git", ["-C", worktree, "diff", "--unified=0", "--diff-filter=d", `${baseSha}..HEAD`], worktree)
  ).out;
  let file = "";
  let at = 0;
  for (const line of diff.split("\n")) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) {
      file = f[1];
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) {
      at = Number(h[1]);
      continue;
    }
    if (!file || !line.startsWith("+")) continue;
    const rows = out.get(file) ?? new Map<number, string>();
    rows.set(at++, line.slice(1));
    out.set(file, rows);
  }
  return out;
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
  // Only the lines THIS RUN WROTE. The scan read whole files and handed a
  // run its own repository back: the regular expression that defines the
  // marker words, the code that formats the report, a fixture string —
  // four confessions, none of them deferrals, in files the run had touched
  // for unrelated reasons. A marker already in the tree is the
  // repository's business; a marker this work added is this work
  // confessing. The difference is what git already knows, and needs no
  // opinion about which words mean what.
  const written = await addedLines(args.worktree, args.baseSha, args.exec);
  for (const rel of [...new Set(delivered)]) {
    if (!isStubScannableFile(rel)) continue;
    const mine = written.get(rel);
    // A path named outside the diff (a check restored from a record) has
    // no added lines to read, and is taken whole as it always was.
    let content = "";
    if (!mine) {
      try {
        content = await fs.readFile(path.join(args.worktree, rel), "utf8");
      } catch {
        continue;
      }
    }
    const hits = mine
      ? [...mine].map(([line, text]) => ({ ...scanStubMarkers(rel, text)[0], file: rel, line }))
          .filter((h): h is { file: string; line: number; text: string; weak: boolean } => !!h.text)
      : scanStubMarkers(rel, content);
    for (const h of hits.filter((x) => !x.weak && !isDeferralVocabulary(x.text))) {
      out.push(`${h.file}:${h.line} confesses a deferral: ${h.text}`);
      args.onHit(h.file, h.line, h.text);
    }
  }
  return out;
}

// The delivery record's persistence (write/read/restore, and the checks
// it keeps) lives in ./deliveryRecord — re-exported here because this
// module is where the run's own callers have always imported it from.
export {
  writeDeliveryRecord,
  recordedCheckPaths,
  restoreChecksFromRecord,
  keptChecks,
} from "./deliveryRecord";

/** Docs gate: a slice that declares documentation (a path `isDocumentationPath`
 *  recognizes — the same definition the sign gate reads) must have LANDED
 *  it — checked against the real tree, and an unmet obligation is
 *  UNDELIVERED on the page's face. A slice that declares no documentation
 *  path at all has no obligation to check here.
 *
 *  The declared-path collection and the present/missing check are done
 *  HERE, not by `unmetDocsObligation`: that function's own path-collector
 *  only recognizes `docs/`-prefixed strings, so it can never name a
 *  root-level document (ENGINE-WIRING.md) as missing. */
export function docsObligations(slices: SliceForDag[], worktree: string): string[] {
  const exists = (rel: string): boolean => {
    try {
      accessSync(path.join(worktree, rel));
      return true;
    } catch {
      return false;
    }
  };
  const out: string[] = [];
  for (const s of slices) {
    const declared = [
      ...(s.files ?? []),
      ...s.workUnits.flatMap((u) => u.footprint ?? []),
    ].filter(isDocumentationPath);
    const missing = [...new Set(declared)].filter((p) => !exists(p));
    if (missing.length)
      out.push(
        `${s.handle}: docs obligation unmet: declared doc-module path(s) not present in the ` +
          `landed tree: ${missing.join(", ")}. The documentation must land with the slice before it can reach Done.`,
      );
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

/**
 * Which slices an earlier run of this cut left standing.
 *
 * A slice its earlier run committed is done on the record and nothing
 * re-runs it; the gate re-proves it like all work. But it stands only if
 * it satisfies THIS plan. One was taken as standing because its name
 * appeared in an earlier run's commits, while the plan had grown from ten
 * checks to sixteen — so the six the plan added were never written, its
 * tester was marked done without ever running, and the failure surfaced
 * two units later as a maintainer that could not reach green, naming
 * nothing a person could act on.
 *
 * What this plan asks for is on disk, or the slice runs again.
 */
export async function standingSlices(
  committed: readonly string[],
  dag: readonly { slice: string; footprint: string[] }[],
  worktree: string,
  log: (line: string) => void,
): Promise<Set<string>> {
  const standing = new Set(committed.filter((sl) => dag.some((u) => u.slice === sl)));
  for (const sl of [...standing]) {
    const owes = await missingProbes(worktree, dag.filter((u) => u.slice === sl).flatMap((u) => u.footprint));
    if (!owes.length) continue;
    standing.delete(sl);
    log(`${sl} was committed by an earlier run, but this plan asks for ${owes.length} check(s) it never wrote — it runs again`);
  }
  return standing;
}
