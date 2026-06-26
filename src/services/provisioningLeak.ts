/**
 * No-leak check — provisioning artifacts must stay out of git
 * (SP-th4wqh / TEP-th3i18, #24, slice SL-3).
 *
 * A fresh worktree provisions its (gitignored) deps by running the repo's
 * declared provisioning recipe. The cautionary case is #16: a hardcoded Node
 * symlink whose output (`node_modules`) was **not** covered by the repo's
 * `.gitignore`, so a later `git add -A` swept it back into the repo. The gap was
 * subtle — `node_modules/` (a trailing-slash dir pattern) does not match a
 * `node_modules` **symlink**, which git treats as a plain file.
 *
 * `provisioningArtifactsIgnored` closes that gap by deriving its verdict from
 * **git itself**, not a hand-rolled `.gitignore` parser: it shells
 * `git check-ignore` inside the repo for each declared provisioning output. That
 * is the same engine `git add -A` consults, so it matches git's real semantics
 * for both regular files and on-disk symlinks — a pattern that "looks" like it
 * covers an output but doesn't (the dir-vs-symlink trap) is reported as a leak.
 *
 * Transport-free and VS-Code-free: it only spawns `git` (read-only) against a
 * repo on disk, so it is unit-testable over a hermetic tmp git fixture.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Verdict for one declared provisioning output.
 */
export interface OutputIgnoreStatus {
  /** The output path as supplied by the caller (named verbatim in reports). */
  path: string;
  /** True when `git check-ignore` says this path is covered by the repo's ignore rules. */
  ignored: boolean;
}

/**
 * Report from {@link provisioningArtifactsIgnored}. `ignored` is true only when
 * **every** declared output is covered by the repo's ignore rules; otherwise
 * {@link ProvisioningLeakReport.leaked} names each uncovered path.
 */
export interface ProvisioningLeakReport {
  /** True iff no provisioning output can leak into the repo (all are gitignored). */
  ignored: boolean;
  /** Per-output verdicts, in the order the outputs were supplied. */
  outputs: OutputIgnoreStatus[];
  /** The output paths NOT covered by the repo's ignore rules (would leak on `git add -A`). */
  leaked: string[];
}

/**
 * Ask git whether a single path is covered by the repo's ignore rules.
 *
 * `git check-ignore -q` exits **0** when the path is ignored and **1** when it
 * is not — both are normal answers, so the exit-1 rejection is translated to
 * `false` rather than surfaced as an error. Any other exit code (e.g. 128 — not
 * a git repo, bad path spec) is a genuine failure and is rethrown.
 *
 * `--no-index` makes the check consult only the ignore rules, ignoring whether
 * the path happens to be tracked — what matters for a leak audit is whether the
 * `.gitignore` pattern actually covers the output, not its current index state.
 */
async function isIgnored(repoRoot: string, output: string): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["-C", repoRoot, "check-ignore", "-q", "--no-index", "--", output],
      { timeout: 5000 },
    );
    return true; // exit 0 → ignored
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 1) return false; // exit 1 → not ignored
    throw err; // 128 / other → real git error
  }
}

/**
 * Confirm via `git check-ignore` that every declared provisioning output is
 * gitignored, so a later `git add -A` can never sweep a provisioning artifact
 * back into the repo (#16).
 *
 * Each output is checked independently against the live ignore engine, so the
 * verdict matches git's own semantics for regular files **and** symlinks (the
 * `node_modules/`-dir-pattern-vs-`node_modules`-symlink gap is caught here). The
 * result is `ignored` only when all outputs are covered; otherwise
 * {@link ProvisioningLeakReport.leaked} names each uncovered path so a caller can
 * say exactly which ignore rule is missing.
 *
 * @param repoRoot  Root of the (worktree's) git repo to check inside.
 * @param outputs   Declared provisioning output paths (relative to `repoRoot`,
 *                   or absolute within it).
 */
export async function provisioningArtifactsIgnored(
  repoRoot: string,
  outputs: string[],
): Promise<ProvisioningLeakReport> {
  const statuses = await Promise.all(
    outputs.map(async (path) => ({
      path,
      ignored: await isIgnored(repoRoot, path),
    })),
  );
  const leaked = statuses.filter((s) => !s.ignored).map((s) => s.path);
  return { ignored: leaked.length === 0, outputs: statuses, leaked };
}

/**
 * One-line, human-readable summary of a {@link ProvisioningLeakReport} —
 * `"ignored"` when nothing can leak, otherwise `"leak: <path>, <path>"` naming
 * the uncovered output(s).
 */
export function describeProvisioningLeak(
  report: ProvisioningLeakReport,
): string {
  return report.ignored ? "ignored" : `leak: ${report.leaked.join(", ")}`;
}
