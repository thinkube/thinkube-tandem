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

const execFileAsync = promisify(execFile);

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
  return entries.find((e) => e.branch === `spec/SP-${specNumber}`);
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
  return { path: path.join(root, `SP-${specNumber}`), reuse: false };
}

/** The MCP server key whose env carries the board location for Claude Code. */
const KANBAN_SERVER = "thinkube-kanban";

/**
 * Inject `THINKUBE_BOARD_ROOT` into the kanban server's env in a parsed
 * `.mcp.json` (SP-tgpwbm AC7), so a freshly-created worktree's Claude-Code-spawned
 * kanban MCP finds the central sidecar board. Pure: takes the parsed config,
 * returns a new config with the value set (other env preserved). A no-op when
 * the kanban server isn't present. The value is machine-specific and stays an
 * uncommitted local edit — never committed (like THINKUBE_FOLDERS). */
export function mcpWithBoardRoot(
  config: unknown,
  boardRoot: string,
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
      env: { ...(s.env ?? {}), THINKUBE_BOARD_ROOT: boardRoot },
    };
  }
  (cfg as { mcpServers?: unknown }).mcpServers = nextServers;
  return cfg as Record<string, unknown>;
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
   * the repo tree so board discovery doesn't pick it up as a nested board).
   * Returns the worktree's absolute path.
   */
  async create(
    canonicalRepo: string,
    specNumber: string,
    baseDir?: string,
    boardRoot?: string,
  ): Promise<string> {
    const branch = `spec/SP-${specNumber}`;
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

    // Board-connect the worktree: inject THINKUBE_BOARD_ROOT into its .mcp.json so
    // the Claude-Code-spawned kanban MCP finds the central sidecar board (AC7).
    if (boardRoot) await this.injectBoardRoot(worktreePath, boardRoot);
    return worktreePath;
  }

  /**
   * Set `THINKUBE_BOARD_ROOT` in the worktree's `.mcp.json` kanban-server env.
   * Best-effort and machine-local — the edit stays uncommitted (never committed,
   * like THINKUBE_FOLDERS). A missing `.mcp.json` is left untouched.
   */
  private async injectBoardRoot(
    worktreePath: string,
    boardRoot: string,
  ): Promise<void> {
    const mcpPath = path.join(worktreePath, ".mcp.json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(mcpPath, "utf8"));
    } catch {
      return; // no .mcp.json to board-connect
    }
    const next = mcpWithBoardRoot(parsed, boardRoot);
    await fs.writeFile(mcpPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  }

  /**
   * Retire a Spec's worktree. Refuses (no silent data loss) when the worktree
   * has uncommitted changes, or when its `spec/SP-{n}` branch still holds
   * commits not in the base branch (retire only after the PR merges). Removing
   * a worktree deletes only its working directory — the branch ref survives, so
   * committed work is never lost. Returns the removed path.
   */
  async remove(canonicalRepo: string, specNumber: string): Promise<string> {
    const wt = findSpecWorktree(await this.list(canonicalRepo), specNumber);
    if (!wt) {
      throw new Error(
        `No worktree for SP-${specNumber} (branch spec/SP-${specNumber}).`,
      );
    }
    if (await this.isDirty(wt.path)) {
      throw new Error(
        `Refusing to retire SP-${specNumber}: the worktree at ${wt.path} has uncommitted changes. Commit or discard them first.`,
      );
    }
    const unmerged = await this.unmergedCount(canonicalRepo, wt.path);
    if (unmerged > 0) {
      throw new Error(
        `Refusing to retire SP-${specNumber}: branch spec/SP-${specNumber} has ${unmerged} commit(s) not in the base branch — merge its PR first.`,
      );
    }
    await execFileAsync(
      "git",
      ["-C", canonicalRepo, "worktree", "remove", wt.path],
      { timeout: 10000 },
    );
    return wt.path;
  }

  /** True when the worktree has uncommitted changes (`git status --porcelain`). */
  private async isDirty(worktreePath: string): Promise<boolean> {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", worktreePath, "status", "--porcelain"],
      { timeout: 5000 },
    );
    return stdout.trim() !== "";
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
