/**
 * OwnershipArbiter — the single Extension-Host authority over which slice owns
 * which files while parallel Specs run in separate worktrees (SP-tgpwbm /
 * TEP-tgpupa).
 *
 * Why a runtime arbiter and not committed markdown: markdown commits aren't
 * atomic and there is exactly one of these per Extension Host, so it can
 * serialize claims. It is the **sole writer** of the durable store, so an
 * in-memory all-or-nothing `acquireClaim` followed by a `persist` is atomic for
 * every caller — other worktree sessions ask THIS process (over IPC, wired by a
 * later slice); they never write the store themselves.
 *
 * Durable, never in-memory-only: claims persist to a `ClaimStore` and the
 * arbiter **rehydrates from it on `activate()`**, so a window reload does not
 * drop ownership. Two stores ship: git refs `refs/locks/*` in the code repo's
 * shared `.git` (preferred — visible to every worktree of that repo, durable in
 * `.git` itself) and a globalStorage JSON journal (the fallback when there is no
 * git repo). The claim algebra and journal codec are pure (`parallelSlices.ts`)
 * and unit-tested; the I/O here mirrors `WorktreeService`'s untested git/fs
 * shell — its live behaviour rides existing machinery and is smoke-checked, not
 * gate-blocking (TEP-tgnvkw).
 */
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  acquireClaim,
  normalizeFilePath,
  parseOwnership,
  reconcileOwnership,
  releaseClaim,
  serializeOwnership,
  type AcquireOutcome,
  type OwnershipState,
  type ReconcileResult,
} from "../methodology/parallelSlices";

const execFileAsync = promisify(execFile);

/** The durable backing for the ownership map. */
export interface ClaimStore {
  /** Read the persisted ownership map (empty when nothing is stored yet). */
  load(): Promise<OwnershipState>;
  /** Persist the full ownership map, replacing what was stored. */
  persist(state: OwnershipState): Promise<void>;
}

/**
 * JSON-journal store (the fallback). One file holds the whole map; writes go to
 * a temp file then rename, so a crash mid-write can't leave a truncated journal.
 */
export class JournalClaimStore implements ClaimStore {
  constructor(private readonly file: string) {}
  /** Serializes persist()s so concurrent callers can't race on the shared temp file. */
  private writeChain: Promise<unknown> = Promise.resolve();

  async load(): Promise<OwnershipState> {
    try {
      return parseOwnership(await fs.readFile(this.file, "utf8"));
    } catch {
      return {}; // no journal yet
    }
  }

  async persist(state: OwnershipState): Promise<void> {
    // The makespan scheduler calls acquire()/release() concurrently (up to the per-Spec cap).
    // With a single `${file}.tmp` path that raced: two writes landed on one temp file, then
    // two renames — the second hit ENOENT because the first had already moved it away. Chain
    // each write-then-rename so it finishes before the next starts. Each serializes the live
    // state at run time, so coalescing is safe — the arbiter's in-memory map is the truth.
    const run = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, serializeOwnership(state), "utf8");
      await fs.rename(tmp, this.file);
    });
    this.writeChain = run.catch(() => undefined);
    return run;
  }
}

/**
 * git-refs store (preferred): each owned file is a ref `refs/locks/<hex>` whose
 * blob content is the owning slice handle. Living in the code repo's shared
 * `.git` means every worktree of that repo sees the same claims and they survive
 * a reload in `.git` itself. The single-writer arbiter makes load/modify/persist
 * atomic for callers, so a full diff-and-apply on `persist` is sufficient.
 */
export class GitRefsClaimStore implements ClaimStore {
  constructor(private readonly repo: string) {}

  /** Repo-relative path → a ref-name-safe hex encoding (and back). */
  private encode(file: string): string {
    return Buffer.from(file, "utf8").toString("hex");
  }
  private decode(hex: string): string {
    return Buffer.from(hex, "hex").toString("utf8");
  }

  /** Write `content` as a git blob, returning its object id. */
  private hashObject(content: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn("git", ["-C", this.repo, "hash-object", "-w", "--stdin"]);
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) =>
        code === 0
          ? resolve(out.trim())
          : reject(new Error(err || `git hash-object exited ${code}`)),
      );
      p.stdin.end(content);
    });
  }

  async load(): Promise<OwnershipState> {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        this.repo,
        "for-each-ref",
        "--format=%(refname) %(objectname)",
        "refs/locks/",
      ],
      { timeout: 5000 },
    );
    const state: OwnershipState = {};
    for (const line of stdout.split(/\r?\n/)) {
      const sp = line.indexOf(" ");
      if (sp === -1) continue;
      const hex = line.slice(0, sp).replace(/^refs\/locks\//, "");
      const oid = line.slice(sp + 1).trim();
      let file: string;
      try {
        file = this.decode(hex);
      } catch {
        continue; // not one of ours
      }
      try {
        const { stdout: blob } = await execFileAsync(
          "git",
          ["-C", this.repo, "cat-file", "blob", oid],
          { timeout: 5000 },
        );
        const slice = blob.trim();
        if (file && slice) state[file] = slice;
      } catch {
        // dangling ref — skip it
      }
    }
    return state;
  }

  async persist(state: OwnershipState): Promise<void> {
    const existing = await this.load();
    // Create / update a ref for every current claim that changed.
    for (const [file, slice] of Object.entries(state)) {
      if (existing[file] === slice) continue;
      const oid = await this.hashObject(slice);
      await execFileAsync(
        "git",
        ["-C", this.repo, "update-ref", `refs/locks/${this.encode(file)}`, oid],
        { timeout: 5000 },
      );
    }
    // Delete refs for files no longer claimed.
    for (const file of Object.keys(existing)) {
      if (file in state) continue;
      await execFileAsync(
        "git",
        [
          "-C",
          this.repo,
          "update-ref",
          "-d",
          `refs/locks/${this.encode(file)}`,
        ],
        { timeout: 5000 },
      );
    }
  }
}

export class OwnershipArbiter {
  /** In-memory cache of the durable map — a cache, not the source of truth. */
  private state: OwnershipState = {};
  private rehydrated = false;

  constructor(private readonly store: ClaimStore) {}

  /**
   * Load the persisted map into memory. Called on `activate()` so a window
   * reload reconstructs ownership rather than starting blank. Idempotent.
   */
  async rehydrate(): Promise<void> {
    this.state = await this.store.load();
    this.rehydrated = true;
  }

  /**
   * Atomically claim `files` for `slice`. On success the new map is persisted
   * before returning, so the claim survives a reload. On a conflict nothing is
   * written and the conflicting files + holders are returned.
   */
  async acquire(slice: string, files: string[]): Promise<AcquireOutcome> {
    const outcome = acquireClaim(this.state, slice, files);
    if (outcome.ok) {
      this.state = outcome.state;
      await this.store.persist(this.state);
    }
    return outcome;
  }

  /** Release every file owned by `slice` and persist. */
  async release(slice: string): Promise<void> {
    this.state = releaseClaim(this.state, slice);
    await this.store.persist(this.state);
  }

  /**
   * Reconcile against the set of slices whose worktrees are still live, dropping
   * (reclaiming) files held by abandoned slices, and persist if anything changed.
   * Returns what was dropped.
   */
  async reconcile(liveSlices: Iterable<string>): Promise<ReconcileResult> {
    const result = reconcileOwnership(this.state, liveSlices);
    if (result.dropped.length) {
      this.state = result.state;
      await this.store.persist(this.state);
    }
    return result;
  }

  /** The slice currently owning `file`, or undefined. */
  owner(file: string): string | undefined {
    return this.state[normalizeFilePath(file)];
  }

  /** A copy of the current ownership map. */
  snapshot(): OwnershipState {
    return { ...this.state };
  }

  /** Whether `rehydrate()` has run (the cache reflects the durable store). */
  get isRehydrated(): boolean {
    return this.rehydrated;
  }
}
