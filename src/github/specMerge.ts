/**
 * Merge a Spec's PR at acceptance (TEP-0010), tolerant of straight-to-main Specs
 *.
 *
 * A Spec normally runs on one branch `spec/SP-<id>` and produces exactly one PR;
 * when the human accepts the Spec (gate green + `accept_spec` stamp), that one PR
 * merges and the Spec is done. The merge SQUASHES (2026-07-11): the branch
 * carries per-unit `wip(...)` checkpoint commits (work survives re-dispatch
 * resets) alongside the verified slice commits, so main receives one verified
 * commit per Spec while the full trail stays readable on the PR. The branch is
 * deleted after, so the Space's branch list stays one-branch-per-active-Spec.
 *
 * But the PR-ceremony rule lets docs / TEPs / thinking space moves / trivial fixes go
 * straight to `main`. Those Specs have no branch (or one with nothing ahead of
 * `main`), so acceptance must NOT depend on a PR existing.
 *
 * The trap this guards against: a branch-ahead Spec whose PR was never
 * opened. "No open PR" alone does NOT mean "nothing to land" — a Spec can have a
 * branch with real commits ahead of `main` and simply never had its PR created.
 * Treating that as a benign no-op silently strands the work on the branch (stamps
 * `accepted` but never merges). So at acceptance we:
 *   - merge an existing open PR; else
 *   - if the Spec branch is ahead of `main`, **push it, open the PR, and merge it**
 *     (the "push, open PR, merge" land the accept gate always promised); else
 *   - report a genuine no-PR / nothing-ahead Spec as a benign no-op (straight to main).
 * A *real* failure (gh missing/unauthenticated, a PR that won't merge, a push that
 * is rejected) still throws with the underlying detail — decoupling from a
 * pre-existing PR must not quietly skip a merge that was actually needed.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** The base branch every Spec branch lands into (TEP-0010). */
const BASE_BRANCH = "main";

/**
 * How many times to poll `ops.mergeable` before giving up (SP-13). A freshly-created
 * PR's mergeability is computed asynchronously by GitHub, so the first probe right after
 * `gh pr create` often comes back not-mergeable-yet; a small bounded retry lets it settle
 * and land on the *first* accept instead of needing a human re-Accept.
 */
const DEFAULT_MAX_ATTEMPTS = 5;

/** Delay (ms) between mergeability polls when no `sleep` seam is injected. */
const MERGE_POLL_DELAY_MS = 2000;

/** Default `sleep` seam: a real timer. Probes inject a no-op counting sleep instead. */
const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Branch convention for a Spec (TEP-0010): one branch per Spec. */
export function specBranch(spec: string): string {
  // Org-scoped tree: a composite spec id `${tep}/${spec}` → the tep-qualified
  // branch `spec/TEP-n_SP-m`; a legacy bare id keeps `spec/SP-{id}`.
  const [tep, sp] = spec.split("/");
  return sp ? `spec/TEP-${tep}_SP-${sp}` : `spec/SP-${spec}`;
}

export type SpecMergeResult =
  | {
      branch: string;
      merged: true;
      /** True when this call opened the PR (branch-ahead, no pre-existing PR). */
      opened: boolean;
      /** Trimmed `gh` stdout (the merge confirmation), for the success toast. */
      output: string;
      /**
       * True when nothing was merged *here* because the Spec had already landed — no
       * open PR and the branch is gone (a prior accept merged + deleted it), or the
       * merge raced and `gh` reported it already merged. Still `merged: true` so the
       * accept dispatch (`acceptOrder`) retires the worktree on an idempotent
       * re-accept instead of throwing on a missing branch and stranding a zombie
       * worktree (#10-residual: already-merged / branch-gone ⇒ success).
       */
      alreadyMerged?: boolean;
    }
  | { branch: string; merged: false; reason: "no-pr" };

/**
 * The `gh` / `git` interactions `mergeSpecPr` needs, injectable so the
 * merged / opened-then-merged / no-op / real-failure classification is
 * unit-testable without `gh`, `git`, or the network.
 */
export interface PrOps {
  /** Number of open PRs whose head is `branch`. Throws if `gh` is missing/unauth. */
  openPrCount(branch: string, cwd: string): Promise<number>;
  /** Commits on `branch` not yet in `main` — `0` ⇒ nothing to land (straight to main). */
  unmergedCommits(branch: string, cwd: string): Promise<number>;
  /**
   * Push `branch` and open its PR against `main`. Resolves once a PR exists for the
   * branch (newly created, or already present); throws with the underlying detail on
   * a real failure (rejected push, `gh` missing/unauth, etc.).
   */
  openPr(branch: string, cwd: string): Promise<void>;
  /** Merge the branch's PR and delete the branch; returns stdout, throws on failure. */
  merge(branch: string, cwd: string): Promise<string>;
  /**
   * Whether the branch's PR is mergeable *right now* — the explicit retry observable
   * (SP-13). GitHub computes a freshly-created PR's mergeability asynchronously, so this
   * can be `false` immediately after `openPr` and `true` a moment later; `mergeSpecPr`
   * polls it (bounded, with an injected delay) before firing `merge`. Backed by
   * `gh pr view --json mergeable,mergeStateStatus`. Keyed off this boolean — NOT a
   * string-match on `merge`'s thrown error — so the retry trigger and the bounded-failure
   * message never collide.
   */
  mergeable(branch: string, cwd: string): Promise<boolean>;
  /**
   * Optional. Whether the Spec branch still exists on the remote. Used only on the
   * no-open-PR path to tell a genuine straight-to-main Spec apart from one that has
   * **already landed** (branch merged + deleted by a prior accept): no PR and a gone
   * branch ⇒ idempotent already-merged success rather than throwing on a missing
   * branch. Returns `true` (or is omitted) ⇒ fall through to the existing ahead-count
   * path, so the classification is never weakened when no detector is wired.
   */
  branchExists?(branch: string, cwd: string): Promise<boolean>;
}

const ghOps: PrOps = {
  async openPrCount(branch, cwd) {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "number"],
      { cwd, timeout: 60000 },
    );
    const parsed = JSON.parse(stdout.trim() || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  },
  async unmergedCommits(branch, cwd) {
    // Compare against the freshly-fetched remote base — local `main` in a Spec
    // worktree can lag behind `origin/main`, which would mis-count what a PR lands.
    await execFileAsync("git", ["fetch", "origin", BASE_BRANCH, "--quiet"], {
      cwd,
      timeout: 60000,
    });
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--count", `origin/${BASE_BRANCH}..${branch}`],
      { cwd, timeout: 60000 },
    );
    return Number.parseInt(stdout.trim(), 10) || 0;
  },
  async openPr(branch, cwd) {
    // Push the branch (the "push" the accept land always promised); a no-op when
    // already up to date, a throw when the remote rejects it.
    try {
      await execFileAsync("git", ["push", "-u", "origin", branch], {
        cwd,
        timeout: 60000,
      });
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      const detail = (e.stderr || e.message || "").trim();
      throw new Error(
        `git push ${branch} failed: ${detail || "unknown error"}`,
      );
    }
    try {
      await execFileAsync(
        "gh",
        ["pr", "create", "--base", BASE_BRANCH, "--head", branch, "--fill"],
        { cwd, timeout: 60000 },
      );
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      const detail = (e.stderr || e.message || "").trim();
      // A PR already exists for the branch (e.g. opened between the count probe and
      // here) — that is exactly the state we wanted, so proceed to the merge.
      if (/already exists/i.test(detail)) return;
      throw new Error(
        `gh pr create ${branch} failed: ${detail || "unknown error"}`,
      );
    }
  },
  async merge(branch, cwd) {
    // Merge ONLY — never `--delete-branch`. That deletes the local branch as part of
    // the merge, which FAILS when the Spec's worktree still holds it ("cannot delete
    // branch … used by worktree") and aborts the whole accept even though the PR
    // merged. Branch cleanup is the retire step's job, run AFTER the
    // worktree is removed — see `WorktreeService.remove` (merge → retire worktree →
    // delete branch, the transaction #10 always described).
    const { stdout } = await execFileAsync(
      "gh",
      // --squash (2026-07-11): the branch now carries per-unit `wip(...)`
      // checkpoint commits alongside the verified slice commits; main
      // receives one verified commit per Spec (trail stays on the PR).
      ["pr", "merge", branch, "--squash"],
      { cwd, timeout: 60000 },
    );
    return stdout.trim();
  },
  async mergeable(branch, cwd) {
    // GitHub computes a fresh PR's mergeability asynchronously: `mergeable` is
    // "MERGEABLE" | "CONFLICTING" | "UNKNOWN", the latter meaning "not computed yet".
    // Only a definite MERGEABLE clears the merge to fire; UNKNOWN (still settling) and
    // CONFLICTING (real conflicts) both keep us polling until the bound is hit.
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", branch, "--json", "mergeable,mergeStateStatus"],
      { cwd, timeout: 60000 },
    );
    const parsed = JSON.parse(stdout.trim() || "{}");
    return parsed.mergeable === "MERGEABLE";
  },
  async branchExists(branch, cwd) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-remote", "--heads", "origin", branch],
        { cwd, timeout: 60000 },
      );
      return stdout.trim().length > 0;
    } catch {
      // The probe itself failed (network, auth) — don't claim the branch is gone,
      // which would skip a merge that may still be needed. Report "exists" so we
      // fall through to the existing ahead-count path.
      return true;
    }
  },
};

/**
 * Resolve and land the Spec's branch at acceptance:
 *   - an open PR → merge it + delete the branch → `{ merged: true, opened: false }`.
 *   - no open PR but the branch is ahead of `main` → push, open the PR, merge it,
 *     delete the branch → `{ merged: true, opened: true }`.
 *   - no open PR and the branch is **gone** (a prior accept already merged + deleted
 *     it) → `{ merged: true, alreadyMerged: true }` — an idempotent re-accept, so the
 *     dispatch still retires any leftover worktree instead of throwing on the missing
 * branch (#10-residual).
 *   - no open PR and nothing ahead of `main` → `{ merged: false, reason: "no-pr" }`
 *     (a genuine straight-to-main Spec; caller stamps anyway).
 * Throws (with the underlying detail) on a real failure: `gh`/`git` missing or
 * unauthenticated, a rejected push, or a PR that exists but won't merge. A merge that
 * `gh` reports as already-merged (a race) is folded into an `alreadyMerged` success,
 * not a throw.
 */
export async function mergeSpecPr(
  spec: string,
  cwd: string,
  ops: PrOps = ghOps,
  opts?: { sleep?: (ms: number) => Promise<void>; maxAttempts?: number },
): Promise<SpecMergeResult> {
  const branch = specBranch(spec);

  let count: number;
  try {
    count = await ops.openPrCount(branch, cwd);
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr || e.message || "unknown error").trim();
    throw new Error(`gh pr list ${branch} failed: ${detail}`);
  }

  let opened = false;
  if (count === 0) {
    // No open PR. The ground truth for "already landed" is whether the branch still
    // has commits NOT in `origin/main` — check THAT first, before any remote-branch
    // probe. A branch ahead of main has unmerged work and MUST be landed (push + open
    // PR + merge), even when the remote branch doesn't exist yet: the orchestrator
    // commits the Spec branch **locally and does not push**, so on the first accept the
    // remote branch is legitimately absent. Treating "no remote branch" as "already
    // merged" here would retire + delete the branch, stranding the only copy of the
    // commit. So the ahead-count gates everything.
    let ahead: number;
    try {
      ahead = await ops.unmergedCommits(branch, cwd);
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      const detail = (e.stderr || e.message || "unknown error").trim();
      throw new Error(`git rev-list ${branch} failed: ${detail}`);
    }
    if (ahead > 0) {
      // Unmerged work: push + open the PR + merge it (the "push, open PR, merge" the
      // accept land always promised). `openPr` pushes first, so this lands even a
      // local-only branch — the #29 fix (and the  "never opened" fix).
      await ops.openPr(branch, cwd);
      opened = true;
    } else {
      // Nothing ahead of `main` — the work is provably already in main. Now (and only
      // now) the remote-branch probe is meaningful: a *gone* branch is a prior accept
      // that already merged + deleted it (idempotent re-accept — report already-merged
      // so the dispatch retires the possibly-zombie worktree,  #10-residual);
      // a *present* branch with nothing ahead is a genuine straight-to-main Spec (no-pr).
      if (ops.branchExists) {
        const exists = await ops.branchExists(branch, cwd);
        if (!exists) {
          return {
            branch,
            merged: true,
            opened: false,
            output: "",
            alreadyMerged: true,
          };
        }
      }
      return { branch, merged: false, reason: "no-pr" };
    }
  }

  // A just-created PR's mergeability is computed asynchronously by GitHub, so a `merge`
  // fired immediately after `openPr` can fail with "not mergeable yet" even though the PR
  // is fine seconds later (SP-6/9). Poll the explicit `mergeable` observable, sleeping an
  // injected delay between tries, up to a bounded `maxAttempts`, so a fresh PR lands on
  // the *first* accept. A PR that never settles surfaces as a clear /mergeable/ error
  // within a predictable ceiling — never an unbounded spin. Delay accounting (pinned):
  // K-false-then-true ⇒ K sleeps; always-false with N attempts ⇒ N-1 sleeps then throw;
  // true-first ⇒ 0 sleeps.
  const sleep = opts?.sleep ?? realSleep;
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let isMergeable = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    isMergeable = await ops.mergeable(branch, cwd);
    if (isMergeable) break;
    if (attempt < maxAttempts) await sleep(MERGE_POLL_DELAY_MS);
  }
  if (!isMergeable) {
    throw new Error(
      `PR for ${branch} never became mergeable within ${maxAttempts} attempts`,
    );
  }

  try {
    const output = await ops.merge(branch, cwd);
    return { branch, merged: true, opened, output };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr || e.message || "unknown error").trim();
    // Idempotent re-accept race: the PR merged between the open-PR probe and here, so
    // `gh` reports it already merged / the branch already gone. That is success, not a
    // failure — the Spec landed, so report it as such (and let the dispatch retire the
    // worktree). A *genuine* merge failure (e.g. "not mergeable", conflicts) still
    // throws with the underlying detail.
    if (
      /already[ -](been[ -])?merged|no commits between|no pull requests? found|not found/i.test(
        detail,
      )
    ) {
      return {
        branch,
        merged: true,
        opened,
        output: detail,
        alreadyMerged: true,
      };
    }
    throw new Error(`gh pr merge ${branch} failed: ${detail}`);
  }
}
