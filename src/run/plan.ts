/**
 * Author-time plan hardening at dispatch: the test-impact blast radius.
 * An existing test that statically imports a changed source file is inside
 * the change — it folds into the slice's TESTER footprint (the tester
 * brings it under; the coder never holds a test); a held-out probe there is
 * a refusal (never an implementer's file). Returns the refusal text, or
 * null when the plan stands (possibly with folded footprints).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SliceForDag } from "../engine/core/dag";
import type { AcVerification } from "../engine/orchestratorCore";
import { buildVerificationTrace } from "../engine/core/trace";
import { unmetDocsObligation } from "../engine/core/redispatch";
import { accessSync } from "node:fs";
import type { Proof } from "../core/schema";
import {
  buildTestImpactRefusal,
  findUncoveredTests,
} from "../engine/testImpactFootprint";
import { isProbePath, isTestPath, testHomesOf } from "./testHomes";
import type { Exec } from "./oracle";
import * as fsp from "node:fs/promises";

/** Held-out evidence this product authors: probes, wherever they sit. */
function isProbe(p: string): boolean {
  return /(^|\/)probes\//.test(p.replace(/\\/g, "/").replace(/^\.\//, ""));
}

export async function foldBlastRadius(
  slices: SliceForDag[],
  repoRoot: string,
  exec: Exec,
  log: (line: string) => void,
): Promise<string | null> {
  const tracked = (await exec("git", ["-C", repoRoot, "ls-files"], repoRoot)).out
    .split("\n")
    .filter((p) => /\.(test|spec|host)\.[a-z]+$|(^|\/)probes\/|(^|\/)acceptance\//.test(p));
  const repoFiles = [];
  for (const rel of tracked) {
    try {
      repoFiles.push({
        path: rel,
        content: await fs.readFile(path.join(repoRoot, rel), "utf8"),
      });
    } catch {
      /* unreadable tracked file — outside the blast scan */
    }
  }
  // A file named as a dependency belongs to the unit that owns it, and to
  // no other. A dependency is declared as a FILE, and the engine resolves
  // it to EVERY unit whose footprint holds that file — so folding a
  // dependency name into a second unit's footprint makes that unit a
  // producer of it, and every consumer gains an edge onto work nobody
  // pointed it at. Two units that both changed code covered by the same
  // test each became a producer of it and each already consumed it, which
  // is a circle, and the engine refuses a circle by refusing the whole
  // run. So a covering test that is already somebody's dependency is not
  // folded: it is not this unit's file to rewrite.
  const dependencyNames = new Set(
    slices.flatMap((s) =>
      s.workUnits.flatMap((u) => (u as { consumes?: string[] }).consumes ?? []),
    ),
  );
  for (const s of slices) {
    const allFootprints = s.workUnits.flatMap((u) => u.footprint);
    const violations = findUncoveredTests({
      changedFiles: s.files ?? [],
      footprintPaths: allFootprints,
      repoFiles,
    });
    // A probe is held-out evidence wherever it lives. The engine calls a
    // test held-out only under `src/acceptance/`; this product writes its
    // probes to `probes/`, so without this they are classified as ordinary
    // unit tests and FOLDED INTO THE CODER'S FOOTPRINT — which opens the
    // write fence on the proof of an already-accepted delivery.
    const classified = violations.map((v) =>
      isProbe(v.test) ? { ...v, kind: "held-out" as const } : v,
    );
    const heldOut = classified.filter((v) => v.kind === "held-out");
    if (heldOut.length) return buildTestImpactRefusal(heldOut);
    const uncovered = classified.filter((v) => v.kind === "unit").map((v) => v.test);
    const folded = uncovered.filter((t) => !dependencyNames.has(t));
    const owned = uncovered.filter((t) => dependencyNames.has(t));
    // A test the change would break is the tester's to bring under — never
    // the coder's, who holds no test in its footprint.
    if (folded.length) {
      const tester = s.workUnits.find((u) => u.role === "test");
      if (tester) {
        tester.footprint.push(...folded);
        log(`${s.handle}: blast radius folded ${folded.join(", ")} into the tester's footprint`);
      } else
        log(`${s.handle}: ${folded.join(", ")} covers this work and no tester owns it — the gate's suite judges`);
    }
    if (owned.length)
      log(
        `${s.handle}: ${owned.join(", ")} covers this work but belongs to the unit it depends on — not folded`,
      );
  }
  return null;
}

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
export function sliceBookkeeping(slices: SliceForDag[]): {
  sliceProbes: Map<string, string[]>;
  /** Existing test homes the slice's tester owns — they ride with the
   *  probes but are never run as checks of their own. */
  sliceTestHomes: Map<string, string[]>;
  sliceVerifs: Map<string, AcVerification[]>;
  sliceFiles: Map<string, string[]>;
  /** What each probe is FOR, in the check's own words — so a result is
   *  reported as the check the human read on the card. */
  checkOf: Map<string, string>;
} {
  const sliceProbes = new Map<string, string[]>();
  const sliceTestHomes = new Map<string, string[]>();
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
    const owned = tests.flatMap((u) => u.footprint);
    const probes = owned.filter(isProbePath);
    sliceProbes.set(s.handle, probes);
    sliceTestHomes.set(s.handle, testHomesOf(owned));
    sliceVerifs.set(
      s.handle,
      probes.map((p, i) => ({ ac: i + 1, run: `node --test ${p}`, env: "local" })),
    );
    sliceFiles.set(s.handle, s.files ?? []);
  }
  return { sliceProbes, sliceTestHomes, sliceVerifs, sliceFiles, checkOf };
}

/**
 * The closing gate's verification list: every probe the run authored, in
 * slice order, each with the ordinal the gate knows it by — and the way
 * back from that ordinal to the probe, so a result can be reported as the
 * check it ran rather than as its position in a list.
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
        verifs.push({ ac: ++ord, run: `node --test ${probe}`, env: "local" });
        probeOfAc.set(ord, probe);
      }
  return { verifs, probeOfAc };
}

/**
 * The honesty scan over the delivered code: every file the run created or
 * changed, read for self-declared deferrals. A confession in a shipped
 * file is UNDELIVERED on the delivery's face, never a footnote.
 */
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
    for (const h of scanStubMarkers(rel, content).filter((x) => !x.weak)) {
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
        },
        null,
        2,
      ),
    );
  } catch {
    /* best-effort */
  }
}


/** Docs gate: a slice that declares documentation (a docs/ touchpoint)
 *  must have LANDED it — the engine's obligation check runs against the
 *  real tree, and an unmet obligation is UNDELIVERED on the page's face. */
export function docsObligations(slices: SliceForDag[], worktree: string): string[] {
  const out: string[] = [];
  for (const s of slices) {
    const declaresDocs = (s.files ?? []).some((f) => f.startsWith("docs/"));
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

/** The plan's role invariant: no coder holds a test-shaped path. Returns
 *  the offending "unit: path" pairs — a plan that breaks the roles is
 *  refused before any worker starts. */
export function coderTestPaths(slices: SliceForDag[]): string[] {
  const out: string[] = [];
  for (const s of slices)
    s.workUnits
      .filter((u) => (u.role ?? "code") === "code")
      .forEach((u, k) => {
        for (const p of u.footprint)
          if (isTestPath(p)) out.push(`${s.handle}#eu-${k}: ${p}`);
      });
  return out;
}
