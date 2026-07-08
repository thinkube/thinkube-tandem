/**
 * The black-box verify oracle (tests-first repair window, 2026-07-08).
 *
 * Under tests-first orchestration the held-out probes are authored BEFORE the coder
 * dispatches, and the coder's only feedback channel is this oracle: an
 * orchestrator-mediated "verify my work" that compiles the coder's current worktree
 * state together with the tester-owned probe sources in an ISOLATED runner directory
 * and returns structured results — compile errors OR per-AC pass/fail + the failing
 * assertion. **Probe source never reaches the coder; results do** (what a human TDD
 * developer sees). This replaces the coder's improvised feedback (own tests, whole-suite
 * self-verify, `npm install`) which caused the footprint-breach class of failures.
 *
 * Shape: a PURE core (porcelain parsing, prepare-failure classification, reply
 * formatting) + a thin shell (`createVerifyOracle`) whose git/copy/exec effects are all
 * injectable, so the module is unit-testable with fakes and the closing gate's runner
 * semantics are reused, not re-derived.
 *
 * Failure attribution (the blind-test-author hardening): the test author writes probes
 * against code that does not exist yet, so a probe that itself fails to COMPILE is a
 * TEST-side fault — the oracle detects that (every compile error located in a probe
 * file) and reports it as `testFault`, so the caller routes it to the fault judge
 * instead of charging it against the coder's iteration budget.
 */
import * as path from "path";

import type { AcVerification } from "./orchestratorCore";

/** One changed path in a worktree, from `git status --porcelain` text. */
export interface OverlayEntry {
  /** Repo-relative path (the porcelain path, rename-target for renames). */
  path: string;
  /** True when the change is a deletion (the runner must remove the file). */
  deleted: boolean;
}

/**
 * Parse `git status --porcelain --untracked-files=all` text into the overlay plan: which
 * files to copy into the runner and which to delete there. Pure. Renames (`R  old -> new`)
 * contribute BOTH a deletion of the old path and a copy of the new one.
 */
export function parsePorcelain(text: string): OverlayEntry[] {
  const out: OverlayEntry[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const xy = raw.slice(0, 2);
    let rest = raw.slice(3).trim();
    // Porcelain may quote paths with special characters; strip one layer of quotes.
    const unquote = (p: string) =>
      p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;
    if (xy.includes("R") || xy.includes("C")) {
      const arrow = rest.indexOf(" -> ");
      if (arrow !== -1) {
        const from = unquote(rest.slice(0, arrow));
        const to = unquote(rest.slice(arrow + 4));
        if (xy.includes("R")) out.push({ path: from, deleted: true });
        out.push({ path: to, deleted: false });
        continue;
      }
    }
    rest = unquote(rest);
    if (!rest) continue;
    out.push({ path: rest, deleted: xy.includes("D") });
  }
  // Dedup, deletions losing to a later add of the same path (checkout-then-recreate).
  const byPath = new Map<string, OverlayEntry>();
  for (const e of out) {
    const prev = byPath.get(e.path);
    if (!prev || (prev.deleted && !e.deleted)) byPath.set(e.path, e);
  }
  return [...byPath.values()];
}

/** Classification of a failed prepare (build/typecheck) run. */
export interface PrepareFailure {
  /** True when EVERY located error path is a probe file — a test-side fault the caller
   *  routes to the fault judge, never charged against the coder. */
  testFault: boolean;
  /** Repo-relative files named in the compiler output (deduped, in first-seen order). */
  errorFiles: string[];
}

/**
 * Classify a failed prepare by the file paths its output names (tsc's
 * `path(line,col): error TS…` shape and plain `path:line` shapes). Pure. Errors located
 * exclusively in probe files ⇒ `testFault` (the probe itself does not compile). No
 * locatable path at all ⇒ not a test fault (fail toward charging the build, not the
 * tester, so a toolchain error is never mis-routed to the judge).
 */
export function classifyPrepareFailure(
  output: string,
  probeFiles: string[],
): PrepareFailure {
  const probes = new Set(probeFiles.map((p) => p.replace(/^\.\//, "")));
  const errorFiles: string[] = [];
  const re = /(^|\s)([\w@./-]+\.[cm]?[jt]sx?)[(:]\d+/gm;
  for (const m of output.matchAll(re)) {
    const f = m[2].replace(/^\.\//, "");
    if (!errorFiles.includes(f)) errorFiles.push(f);
  }
  const testFault =
    errorFiles.length > 0 && errorFiles.every((f) => probes.has(f));
  return { testFault, errorFiles };
}

/** One per-AC probe outcome the oracle returns to the coder. */
export interface OracleAcResult {
  ac: number;
  pass: boolean;
  /** Bounded evidence: the command's exit + the first failing assertion block. */
  evidence: string;
}

/** The oracle's structured verdict for one `verify()` invocation. */
export type VerifyResult =
  | {
      kind: "build-failed";
      /** Compile errors located exclusively in probe files — test-side fault. */
      testFault: boolean;
      errorFiles: string[];
      /** Bounded raw compiler output. */
      output: string;
    }
  | { kind: "results"; results: OracleAcResult[] }
  | { kind: "exhausted"; invocations: number };

const clip = (s: string, n: number): string =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

/** Bounded evidence for one probe run: exit line + first failing assertion block. */
export function probeEvidence(
  run: string,
  code: number | null,
  output: string,
): string {
  const lines = output.split("\n").map((l) => l.replace(/\s+$/, ""));
  const head = `$ ${run} → exit ${code ?? "null"}`;
  if (code === 0) return head;
  const at = lines.findIndex((l) => /^\s*not ok /.test(l));
  const detail =
    at !== -1
      ? lines
          .slice(at, at + 14)
          .join("\n")
          .trim()
      : lines.slice(-10).join("\n").trim();
  return detail ? `${head}\n${clip(detail, 900)}` : head;
}

/**
 * Render a {@link VerifyResult} as the tool reply the coder reads. Pure. Never leaks
 * probe SOURCE — only locations, pass/fail and assertion output. A test-side build
 * fault tells the coder to keep working from the contract (the orchestrator routes the
 * broken probe to the judge; it is not the coder's to fix).
 */
export function formatVerifyReply(r: VerifyResult): string {
  if (r.kind === "exhausted") {
    return `VERIFY LIMIT REACHED (${r.invocations} invocations). Stop iterating; summarize where you are and what remains — the run will park for review.`;
  }
  if (r.kind === "build-failed") {
    if (r.testFault) {
      return [
        "BUILD FAILED — in the acceptance probes, not your code. This is being routed for review; it is NOT yours to fix and does not count against you.",
        "Keep implementing to the CONTRACT. Files at fault: " +
          r.errorFiles.join(", "),
      ].join("\n");
    }
    return ["BUILD FAILED — compile errors:", clip(r.output, 4000)].join("\n");
  }
  const pass = r.results.filter((x) => x.pass).length;
  const head = `PROBES: ${pass}/${r.results.length} pass`;
  const body = r.results
    .map((x) => `AC-${x.ac}: ${x.pass ? "PASS" : "FAIL"}\n${x.evidence}`)
    .join("\n\n");
  return `${head}\n\n${body}`;
}

/** Injectable effects for {@link createVerifyOracle} — all defaulted to real I/O by the caller. */
export interface VerifyOracleDeps {
  /** The coder's (shared) code worktree — the state under verification. */
  codeWorktree: string;
  /** The tester snapshot holding the probe sources. */
  testerWorktree: string;
  /** The isolated runner directory (a detached worktree the caller prepared). */
  runnerDir: string;
  /** Repo-relative probe source paths (the slice's role:test footprints). */
  probeFiles: string[];
  /** The recipe's build/typecheck command (run in the runner before the probes). */
  prepare?: string;
  /** The slice's runnable per-AC verifications (assessment entries are skipped). */
  verifications: AcVerification[];
  /** Run a shell command; the closing gate's bounded exec is the production value. */
  exec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  /** `git status --porcelain --untracked-files=all` of the code worktree. */
  porcelain: (cwd: string) => Promise<string>;
  /** Reset the runner to the code worktree's current base commit (hard reset + clean). */
  resetRunner: () => Promise<void>;
  /** Copy one repo-relative file src-tree → runner (creating parent dirs). */
  copyIn: (fromRoot: string, rel: string) => Promise<void>;
  /** Delete one repo-relative file in the runner (missing file is fine). */
  removeIn: (rel: string) => Promise<void>;
  /** Invocation budget before the oracle reports `exhausted` (default 20). */
  maxInvocations?: number;
  log?: (line: string) => void;
}

export interface VerifyOracle {
  /** Run one verification round; serialized (concurrent calls queue). */
  verify(): Promise<VerifyResult>;
  /** Invocations consumed so far. */
  invocations(): number;
}

/**
 * The oracle shell: overlay the coder's current delta + the probe sources into the
 * isolated runner, run `prepare`, then the per-AC probe commands. Calls are serialized
 * through an internal queue (one runner per slice) and capped by `maxInvocations`.
 */
export function createVerifyOracle(deps: VerifyOracleDeps): VerifyOracle {
  const max = deps.maxInvocations ?? 20;
  const log = deps.log ?? (() => {});
  let used = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const round = async (): Promise<VerifyResult> => {
    if (used >= max) return { kind: "exhausted", invocations: used };
    used++;
    // 1. Fresh runner at the coder's base commit, then overlay the coder's dirty delta.
    await deps.resetRunner();
    const entries = parsePorcelain(await deps.porcelain(deps.codeWorktree));
    for (const e of entries) {
      if (e.deleted) await deps.removeIn(e.path);
      else await deps.copyIn(deps.codeWorktree, e.path);
    }
    // 2. Overlay the tester-owned probe sources (never visible in the coder's tree).
    for (const rel of deps.probeFiles)
      await deps.copyIn(deps.testerWorktree, rel);
    // 3. Build. A failure located ONLY in probe files is a test-side fault.
    if (deps.prepare) {
      const b = await deps.exec(deps.prepare, deps.runnerDir);
      if (b.code !== 0) {
        const cls = classifyPrepareFailure(b.output, deps.probeFiles);
        log(
          `  [oracle] build failed (${cls.testFault ? "test-side" : "code-side"}): ${cls.errorFiles.join(", ") || "no file located"}`,
        );
        return {
          kind: "build-failed",
          testFault: cls.testFault,
          errorFiles: cls.errorFiles,
          output: clip(b.output, 6000),
        };
      }
    }
    // 4. Run the slice's runnable probes.
    const results: OracleAcResult[] = [];
    for (const v of deps.verifications) {
      if (v.env === "assessment" || !v.run) continue;
      const r = await deps.exec(v.run, deps.runnerDir);
      results.push({
        ac: v.ac,
        pass: r.code === 0,
        evidence: probeEvidence(v.run, r.code, r.output),
      });
    }
    log(
      `  [oracle] round ${used}/${max}: ${results.filter((r) => r.pass).length}/${results.length} pass`,
    );
    return { kind: "results", results };
  };

  return {
    verify(): Promise<VerifyResult> {
      const next = queue.then(round, round);
      queue = next.catch(() => undefined);
      return next;
    },
    invocations: () => used,
  };
}

/** Repo-relative → absolute path join, exported for the wiring layer's copy/remove helpers. */
export function runnerPath(root: string, rel: string): string {
  return path.join(root, rel.replace(/^\.\//, ""));
}
