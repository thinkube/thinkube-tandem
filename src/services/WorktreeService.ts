/**
 * WorktreeService — create and resolve git worktrees so each Spec can be
 * worked in its own isolated working directory (SP-5).
 *
 * A git worktree is a separate checkout of the same repo on its own branch.
 * Running parallel Specs in separate worktrees keeps their uncommitted changes
 * physically apart — Spec A's edits can't leak into Spec B's `git status` or
 * commit, which is the whole point.
 *
 * No vscode here — this is a thin `git` wrapper (via `execFile`, like
 * `github/gitRemote.ts`); the command layer owns the UI. The porcelain parser
 * is a pure function so it can be unit-tested without a repo.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { provisionWorktree } from "./worktreeProvision";

const execFileAsync = promisify(execFile);

/** Branch for a Spec — `spec/TEP-n_SP-m` for an org-scoped composite id
 *  (`${tep}/${spec}`), legacy `spec/SP-{id}` for a bare id. */
function specBranchName(specNumber: string): string {
  const [tep, sp] = specNumber.split("/");
  return sp ? `spec/TEP-${tep}_SP-${sp}` : `spec/SP-${specNumber}`;
}
/** Worktree directory leaf for a Spec (the tep-qualified handle, or legacy). */
function specWtName(specNumber: string): string {
  const [tep, sp] = specNumber.split("/");
  return sp ? `TEP-${tep}_SP-${sp}` : `SP-${specNumber}`;
}
/** Worktree directory leaf for a Spec's TESTER snapshot (SP-6/7 structural independence). */
export function testerWtName(specNumber: string): string {
  return `${specWtName(specNumber)}-test`;
}

export interface WorktreeEntry {
  /** Absolute path of the worktree's working directory. */
  path: string;
  /** Commit SHA the worktree is checked out at. */
  head?: string;
  /** Short branch name (`refs/heads/` stripped), e.g. `spec/SP-5`. */
  branch?: string;
  bare?: boolean;
  detached?: boolean;
}

/**
 * Parse `git worktree list --porcelain` into entries. Records are separated by
 * blank lines; the first record is always the canonical (main) worktree. Pure.
 */
export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let cur: WorktreeEntry | undefined;
  const flush = () => {
    if (cur) {
      entries.push(cur);
      cur = undefined;
    }
  };
  for (const raw of porcelain.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    const sp = line.indexOf(" ");
    const key = sp === -1 ? line : line.slice(0, sp);
    const val = sp === -1 ? "" : line.slice(sp + 1);
    switch (key) {
      case "worktree":
        flush();
        cur = { path: val };
        break;
      case "HEAD":
        if (cur) cur.head = val;
        break;
      case "branch":
        if (cur) cur.branch = val.replace(/^refs\/heads\//, "");
        break;
      case "bare":
        if (cur) cur.bare = true;
        break;
      case "detached":
        if (cur) cur.detached = true;
        break;
      default:
        break;
    }
  }
  flush();
  return entries;
}

/** A linked worktree's identity: its canonical repo and its worktree name. */
export interface LinkedWorktree {
  /** Absolute path of the canonical (main) repo this worktree belongs to. */
  canonicalRepo: string;
  /** The worktree's git name (its directory basename when created), e.g. `SP-5`. */
  name: string;
}

/**
 * Parse a linked worktree's `.git` file — a one-line pointer of the form
 * `gitdir: <canonical>/.git/worktrees/<name>` — into its canonical repo and
 * name. Returns undefined for anything that isn't a worktree gitdir pointer
 * (e.g. a normal repo's `.git` directory, which has no such file). Pure.
 */
export function parseGitdir(content: string): LinkedWorktree | undefined {
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(content);
  if (!m) return undefined;
  const gitdir = m[1].replace(/\\/g, "/").replace(/\/+$/, "");
  const marker = "/.git/worktrees/";
  const at = gitdir.lastIndexOf(marker);
  if (at === -1) return undefined;
  const canonicalRepo = gitdir.slice(0, at);
  const name = gitdir.slice(at + marker.length).split("/")[0];
  if (!canonicalRepo || !name) return undefined;
  return { canonicalRepo, name };
}

/**
 * Identify `dir` as a linked worktree by reading its `.git` *file* (a worktree
 * has a `.git` file pointing at the canonical repo; a normal checkout has a
 * `.git` directory). Sync — safe to call from the discovery walks. Returns
 * undefined when `dir` is not a linked worktree.
 */
export function linkedWorktreeInfo(dir: string): LinkedWorktree | undefined {
  const gitPath = path.join(dir, ".git");
  try {
    if (!statSync(gitPath).isFile()) return undefined;
    return parseGitdir(readFileSync(gitPath, "utf8"));
  } catch {
    return undefined;
  }
}

/** The worktree entry checked out on branch `spec/SP-{n}`, or undefined. Pure. */
export function findSpecWorktree(
  entries: WorktreeEntry[],
  specNumber: string,
): WorktreeEntry | undefined {
  return entries.find((e) => e.branch === specBranchName(specNumber));
}

/**
 * Decide where a Spec's worktree lives, **reusing** an existing one rather than
 * trying to re-add it (SP-tgpwbm AC7). If a worktree is already checked out on
 * `spec/SP-{n}`, return its path with `reuse: true`; otherwise compute the path
 * under `baseDir` (default: a sibling `<repo>-worktrees/`) with `reuse: false`.
 * Pure — the I/O (`git worktree add`) is the caller's job, and only when not
 * reusing. This is what lets `create` be idempotent instead of throwing on
 * "already exists". */
export function planWorktree(
  existing: WorktreeEntry[],
  canonicalRepo: string,
  specNumber: string,
  baseDir?: string,
): { path: string; reuse: boolean } {
  const found = findSpecWorktree(existing, specNumber);
  if (found) return { path: found.path, reuse: true };
  const root =
    baseDir ??
    path.join(
      path.dirname(canonicalRepo),
      `${path.basename(canonicalRepo)}-worktrees`,
    );
  return { path: path.join(root, specWtName(specNumber)), reuse: false };
}

/** The MCP server key whose env carries the thinking space location for Claude Code. */
const KANBAN_SERVER = "thinkube-kanban";

/**
 * Inject `THINKUBE_THINKING_SPACE_ROOT` into the kanban server's env in a parsed
 * `.mcp.json` (SP-tgpwbm AC7), so a freshly-created worktree's Claude-Code-spawned
 * kanban MCP finds the central sidecar thinking space. Pure: takes the parsed config,
 * returns a new config with the value set (other env preserved). A no-op when
 * the kanban server isn't present. The value is machine-specific and stays an
 * uncommitted local edit — never committed (like THINKUBE_FOLDERS). */
export function mcpWithThinkingSpaceRoot(
  config: unknown,
  thinkingSpaceRoot: string,
): Record<string, unknown> {
  const cfg =
    config && typeof config === "object" ? { ...(config as object) } : {};
  const servers = (cfg as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object")
    return cfg as Record<string, unknown>;
  const nextServers: Record<string, unknown> = {
    ...(servers as Record<string, unknown>),
  };
  const server = nextServers[KANBAN_SERVER];
  if (server && typeof server === "object") {
    const s = server as { env?: Record<string, unknown>; [k: string]: unknown };
    nextServers[KANBAN_SERVER] = {
      ...s,
      env: { ...(s.env ?? {}), THINKUBE_THINKING_SPACE_ROOT: thinkingSpaceRoot },
    };
  }
  (cfg as { mcpServers?: unknown }).mcpServers = nextServers;
  return cfg as Record<string, unknown>;
}

/**
 * Retire-safe iff the worktree is clean except for its machine-local `.mcp.json`
 * (the per-worktree thinking space-env injection, SP-tgpwbm SL-7) — never committed, so it
 * must not block retirement. Any other porcelain entry → not retirable. Pure.
 * Input is `git status --porcelain` text (`XY <path>` per line).
 */
export function worktreeRetirable(porcelain: string): boolean {
  const entries = porcelain
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "");
  return entries.every((line) => {
    // Porcelain is `XY <path>` (two status columns + space); strip to the path
    // and unquote a path git quoted for special chars.
    const p = line.slice(3).replace(/^"(.*)"$/, "$1");
    return p === ".mcp.json";
  });
}

/**
 * `"defer"` when `cwd` is the worktree being retired or sits inside it — deleting
 * it would pull the rug from the session running the accept; otherwise `"retire"`.
 * Pure.
 */
export function retirePlan(
  cwd: string,
  worktreePath: string,
): "retire" | "defer" {
  const norm = (p: string) => path.resolve(p).replace(/[/\\]+$/, "");
  const wt = norm(worktreePath);
  const here = norm(cwd);
  return here === wt || here.startsWith(wt + path.sep) ? "defer" : "retire";
}

/**
 * Decide whether symlinking `target` as `repoRoot`'s `node_modules` would be
 * self-referential — i.e. the link would point the repo's deps dir at itself.
 * Returns `true` when the link is **safe** (target resolves somewhere other than
 * `repoRoot/node_modules`), `false` when it would point at itself.
 *
 * Comparison is on **realpath-resolved** paths, so it's robust to the ways two
 * spellings can name the same location: `a/../node_modules`, a trailing slash,
 * or a symlinked repo root. The would-be link (`repoRoot/node_modules`) usually
 * doesn't exist yet — we can't `realpath` it directly — so we resolve its
 * longest existing ancestor and re-append the remaining segments, which still
 * follows a symlinked root correctly. Must be called before `fs.symlink` so a
 * self-link is refused rather than created (it would break `node_modules`).
 */
export async function nodeModulesLinkSafe(
  target: string,
  repoRoot: string,
): Promise<boolean> {
  // realpath only resolves existing paths; for a not-yet-created path resolve
  // its longest existing ancestor (following symlinks) and re-join the rest.
  const resolveReal = async (p: string): Promise<string> => {
    const abs = path.resolve(p);
    try {
      return await fs.realpath(abs);
    } catch {
      const parent = path.dirname(abs);
      if (parent === abs) return abs; // reached the root; nothing left to resolve
      return path.join(await resolveReal(parent), path.basename(abs));
    }
  };
  const linkPath = path.join(repoRoot, "node_modules");
  const [realTarget, realLink] = await Promise.all([
    resolveReal(target),
    resolveReal(linkPath),
  ]);
  return realTarget !== realLink;
}

/** Outcome of {@link linkNodeModules}. */
export type LinkNodeModulesResult =
  /** A fresh `node_modules` symlink was created. */
  | "linked"
  /** Refused — the link would be self-referential ({@link nodeModulesLinkSafe} said no). */
  | "refused"
  /** Skipped — the worktree already has a `node_modules` (real dir or prior link). */
  | "skipped";

/**
 * The Node **recipe default**: symlink `src` (a canonical repo's `node_modules`)
 * into `worktreePath` so a Node project's fresh worktree can build/verify without
 * a full install. This is no longer wired into worktree creation — provisioning
 * is now driven by the repo's *declared* recipe ({@link provisionWorktree}) and
 * the runner is language-agnostic — but it is the safe primitive a symlink-style
 * `repo-conventions` recipe (or a caller) uses, so the self-link guard lives at
 * the one `fs.symlink` call site rather than scattered through recipe text.
 *
 * Idempotent: a pre-existing `node_modules` is left untouched (`"skipped"`).
 * **Guarded:** {@link nodeModulesLinkSafe} is consulted *before* `fs.symlink`, so
 * a link that would point the worktree's deps dir at itself is refused
 * (`"refused"`) rather than created — the #16 self-link that breaks `node_modules`.
 */
export async function linkNodeModules(
  src: string,
  worktreePath: string,
): Promise<LinkNodeModulesResult> {
  const dst = path.join(worktreePath, "node_modules");
  // Idempotent: never clobber an existing node_modules (real dir or prior link).
  try {
    await fs.lstat(dst);
    return "skipped";
  } catch {
    /* dst missing → candidate for linking */
  }
  // Guard BEFORE fs.symlink — refuse a self-referential link (#16).
  if (!(await nodeModulesLinkSafe(src, worktreePath))) {
    return "refused";
  }
  await fs.symlink(src, dst, "dir");
  return "linked";
}

export class WorktreeService {
  /** All worktrees of the repo enclosing `cwd`; the first entry is canonical. */
  async list(cwd: string): Promise<WorktreeEntry[]> {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "worktree", "list", "--porcelain"],
      { timeout: 5000 },
    );
    return parseWorktreeList(stdout);
  }

  /**
   * The canonical (main) repo path enclosing `cwd` — the same value whether
   * `cwd` is the main checkout or a linked worktree, since `git worktree list`
   * reports the shared set. Undefined when `cwd` isn't in a git repo.
   */
  async canonicalRepo(cwd: string): Promise<string | undefined> {
    try {
      const entries = await this.list(cwd);
      return entries[0]?.path;
    } catch {
      return undefined;
    }
  }

  /**
   * Create (or reuse) the worktree for a Spec on branch `spec/SP-{n}`, rooted
   * under `baseDir` (default: a sibling `<repo>-worktrees/` dir, kept outside
   * the repo tree so thinking space discovery doesn't pick it up as a nested thinking space).
   * Returns the worktree's absolute path.
   */
  async create(
    canonicalRepo: string,
    specNumber: string,
    baseDir?: string,
    thinkingSpaceRoot?: string,
  ): Promise<string> {
    const branch = specBranchName(specNumber);
    // Reuse an existing worktree for this Spec rather than failing on "already
    // exists" — re-starting a Spec must be idempotent (SP-tgpwbm AC7).
    const plan = planWorktree(
      await this.list(canonicalRepo),
      canonicalRepo,
      specNumber,
      baseDir,
    );
    let worktreePath = plan.path;
    if (!plan.reuse) {
      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      // Reuse the Spec's branch if it already exists (re-starting a Spec); else
      // cut a fresh one from the canonical repo's current HEAD.
      const exists = await this.refExists(
        canonicalRepo,
        `refs/heads/${branch}`,
      );
      const addArgs = exists
        ? ["-C", canonicalRepo, "worktree", "add", worktreePath, branch]
        : ["-C", canonicalRepo, "worktree", "add", worktreePath, "-b", branch];
      try {
        await execFileAsync("git", addArgs, { timeout: 15000 });
      } catch (err) {
        // A worktree may have appeared (race / pre-existing dir now registered);
        // reuse it instead of surfacing the add failure.
        const now = findSpecWorktree(
          await this.list(canonicalRepo),
          specNumber,
        );
        if (now) worktreePath = now.path;
        else throw err;
      }
    }

    // Thinking Space-connect the worktree: inject THINKUBE_THINKING_SPACE_ROOT into its .mcp.json so
    // the Claude-Code-spawned kanban MCP finds the central sidecar thinking space (AC7).
    if (thinkingSpaceRoot) await this.injectThinkingSpaceRoot(worktreePath, thinkingSpaceRoot);
    // Provision the fresh worktree by running the repo's declared "Worktree setup"
    // recipe (repo-conventions) via runBounded, so a fresh checkout — which has no
    // gitignored deps — can run its tooling. Language-agnostic: this replaces the old
    // hardcoded Node-only node_modules symlink, which didn't generalize and leaked
    // into git (SP-th4wqh, #16/#24). No recipe declared → provisions nothing.
    await provisionWorktree(canonicalRepo, worktreePath);
    return worktreePath;
  }

  /**
   * Create (or re-point) the Spec's TESTER worktree (SP-6/7 structural independence): a
   * **detached** checkout at the Spec branch's current committed HEAD — every base file is
   * present, the code workers' *uncommitted modifications* are absent **by construction**
   * (committed earlier slices, being part of the branch, are legitimately visible). The
   * held-out `role: test` workers run with this as cwd: they read and write in ONE
   * directory, and there is simply nothing implementation-in-progress to read. On reuse the
   * tree is hard-reset to the branch's current HEAD, so every run grades a fresh snapshot.
   * Detached (no branch): nothing is ever committed from it — the orchestrator copies the
   * finished probes into the code worktree before the closing gate runs them.
   */
  async createTester(
    canonicalRepo: string,
    specNumber: string,
    baseDir?: string,
  ): Promise<string> {
    const branch = specBranchName(specNumber);
    const ref = (await this.refExists(canonicalRepo, `refs/heads/${branch}`))
      ? branch
      : "HEAD";
    const { stdout: shaRaw } = await execFileAsync(
      "git",
      ["-C", canonicalRepo, "rev-parse", ref],
      { timeout: 5000 },
    );
    const sha = shaRaw.trim();
    const root =
      baseDir ??
      path.join(
        path.dirname(canonicalRepo),
        `${path.basename(canonicalRepo)}-worktrees`,
      );
    const wtPath = path.join(root, testerWtName(specNumber));
    const existing = (await this.list(canonicalRepo)).find(
      (e) => path.resolve(e.path) === path.resolve(wtPath),
    );
    if (existing) {
      // Reuse = re-snapshot: hard-reset the detached tree to the branch's CURRENT commit and
      // drop leftovers from a prior run (`clean -fd`, no -x — gitignored provisioning like
      // node_modules survives). The tester always authors against a fresh base.
      await execFileAsync("git", ["-C", wtPath, "reset", "--hard", sha], {
        timeout: 15000,
      });
      await execFileAsync("git", ["-C", wtPath, "clean", "-fd"], {
        timeout: 15000,
      });
      return wtPath;
    }
    await fs.mkdir(path.dirname(wtPath), { recursive: true });
    try {
      await execFileAsync(
        "git",
        ["-C", canonicalRepo, "worktree", "add", "--detach", wtPath, sha],
        { timeout: 15000 },
      );
    } catch (err) {
      // Race / pre-existing dir now registered — reuse it if git knows it, else surface.
      const now = (await this.list(canonicalRepo)).find(
        (e) => path.resolve(e.path) === path.resolve(wtPath),
      );
      if (!now) throw err;
    }
    return wtPath;
  }

  /**
   * Reset a worktree to its branch's committed state (SP-6/7 lifecycle): `reset --hard` +
   * `clean -fd` (no `-x` — gitignored provisioning like `node_modules`/`out-test` survives),
   * then re-inject the machine-local thinking-space env the reset reverted. Used at
   * (re)dispatch so stale, uncommitted output from a prior run can never linger under a new
   * contract; committed work lives on the branch and survives.
   */
  async reset(worktreePath: string, thinkingSpaceRoot?: string): Promise<void> {
    await execFileAsync("git", ["-C", worktreePath, "reset", "--hard"], {
      timeout: 15000,
    });
    await execFileAsync("git", ["-C", worktreePath, "clean", "-fd"], {
      timeout: 15000,
    });
    if (thinkingSpaceRoot)
      await this.injectThinkingSpaceRoot(worktreePath, thinkingSpaceRoot);
  }

  /**
   * Set `THINKUBE_THINKING_SPACE_ROOT` in the worktree's `.mcp.json` kanban-server env.
   * Best-effort and machine-local — the edit stays uncommitted (never committed,
   * like THINKUBE_FOLDERS). A missing `.mcp.json` is left untouched.
   */
  private async injectThinkingSpaceRoot(
    worktreePath: string,
    thinkingSpaceRoot: string,
  ): Promise<void> {
    const mcpPath = path.join(worktreePath, ".mcp.json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(mcpPath, "utf8"));
    } catch {
      return; // no .mcp.json to thinking space-connect
    }
    const next = mcpWithThinkingSpaceRoot(parsed, thinkingSpaceRoot);
    await fs.writeFile(mcpPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  }

  /**
   * Retire a Spec's worktree after its work has landed. Refuses (no silent data
   * loss) when the worktree has uncommitted changes beyond its machine-local
   * `.mcp.json` (`worktreeRetirable`), or — unless `assumeMerged` — when its
   * `spec/SP-{n}` branch still holds commits not in the base branch. `assumeMerged`
   * is set by `retireAfterAccept`, where the merge was just confirmed by `gh` (the
   * local base ref lags the remote merge, so the unmerged probe would false-refuse).
   * With `assumeMerged` the now-merged local branch ref is deleted too. Returns the
   * removed path.
   */
  async remove(
    canonicalRepo: string,
    specNumber: string,
    opts: { assumeMerged?: boolean } = {},
  ): Promise<string> {
    const wt = findSpecWorktree(await this.list(canonicalRepo), specNumber);
    if (!wt) {
      throw new Error(
        `No worktree for SP-${specNumber} (branch spec/SP-${specNumber}).`,
      );
    }
    const { stdout: porcelain } = await execFileAsync(
      "git",
      ["-C", wt.path, "status", "--porcelain"],
      { timeout: 5000 },
    );
    if (!worktreeRetirable(porcelain)) {
      throw new Error(
        `Refusing to retire SP-${specNumber}: the worktree at ${wt.path} has uncommitted changes (beyond .mcp.json). Commit or discard them first.`,
      );
    }
    if (!opts.assumeMerged) {
      const unmerged = await this.unmergedCount(canonicalRepo, wt.path);
      if (unmerged > 0) {
        throw new Error(
          `Refusing to retire SP-${specNumber}: branch spec/SP-${specNumber} has ${unmerged} commit(s) not in the base branch — merge its PR first.`,
        );
      }
    }
    // `--force` ignores only the `.mcp.json` dirt we already vetted via
    // `worktreeRetirable`; anything else would have thrown above.
    await execFileAsync(
      "git",
      ["-C", canonicalRepo, "worktree", "remove", "--force", wt.path],
      { timeout: 10000 },
    );
    // Best-effort: retire the Spec's TESTER snapshot too (SP-6/7). Detached + never committed
    // from, so nothing can be lost; a failure must never block the accept cleanup.
    const tester = (await this.list(canonicalRepo)).find(
      (e) => path.basename(e.path) === testerWtName(specNumber),
    );
    if (tester) {
      await execFileAsync(
        "git",
        ["-C", canonicalRepo, "worktree", "remove", "--force", tester.path],
        { timeout: 10000 },
      ).catch(() => undefined);
    }
    if (opts.assumeMerged) {
      // The branch is merged (work is on the remote base) and the worktree is now gone,
      // so drop BOTH the local ref and the remote branch — the cleanup the merge no
      // longer does via `--delete-branch` (which raced this very worktree, #10). Order
      // matters: worktree removed first (above), THEN the branch, so neither delete can
      // fail on "branch used by worktree". Best-effort — a failed branch cleanup must
      // never turn a landed, stamped accept into an error.
      await execFileAsync(
        "git",
        ["-C", canonicalRepo, "branch", "-D", specBranchName(specNumber)],
        { timeout: 5000 },
      ).catch(() => undefined);
      await execFileAsync(
        "git",
        [
          "-C",
          canonicalRepo,
          "push",
          "origin",
          "--delete",
          specBranchName(specNumber),
        ],
        { timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      ).catch(() => undefined);
    }
    return wt.path;
  }

  /**
   * Retire the Spec's worktree as the cleanup half of accept-land (TEP-tgqa78),
   * after a confirmed merge. Defers when the accept fires from inside the worktree
   * being retired (`retirePlan`) so it never deletes the active session's own cwd.
   * Returns what happened so the caller can message it.
   */
  async retireAfterAccept(
    canonicalRepo: string,
    specNumber: string,
    cwd: string,
  ): Promise<"retired" | "deferred" | "absent"> {
    const wt = findSpecWorktree(await this.list(canonicalRepo), specNumber);
    if (!wt) return "absent";
    if (retirePlan(cwd, wt.path) === "defer") return "deferred";
    await this.remove(canonicalRepo, specNumber, { assumeMerged: true });
    return "retired";
  }

  /**
   * Commits on the worktree's HEAD not yet in the base branch (the canonical
   * repo's current branch — typically `main`). 0 when the base can't be
   * resolved or the canonical HEAD is detached, so the merge-state guard never
   * blocks on ambiguity.
   */
  private async unmergedCount(
    canonicalRepo: string,
    worktreePath: string,
  ): Promise<number> {
    let base: string;
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", canonicalRepo, "rev-parse", "--abbrev-ref", "HEAD"],
        { timeout: 5000 },
      );
      base = stdout.trim();
    } catch {
      return 0;
    }
    if (!base || base === "HEAD") return 0;
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", worktreePath, "rev-list", "--count", `${base}..HEAD`],
        { timeout: 5000 },
      );
      return Number(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  private async refExists(cwd: string, ref: string): Promise<boolean> {
    try {
      await execFileAsync(
        "git",
        ["-C", cwd, "rev-parse", "--verify", "--quiet", ref],
        { timeout: 5000 },
      );
      return true;
    } catch {
      return false;
    }
  }
}
