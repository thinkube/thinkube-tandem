/**
 * STORE AUTOSYNC — the thinking-space store commits and pushes itself every
 * five minutes when dirty.
 *
 * Rationale (2026-08-04): Thinkube's user is a solo developer in a pod, the
 * cluster has no backup policy, so the pushed store IS the backup — yet
 * nothing anywhere implemented the assumed periodic sync (no cron in the
 * pod, no timer in the extension, no hooks), and space state repeatedly sat
 * dirty for days. The store is a JOURNAL, not authored code: `add -A` within
 * the store root is correct here (everything under it is space bookkeeping),
 * unlike code repos where the scoped-paths rule stands.
 *
 * Fail-soft and quiet: a failed push (offline, auth) logs once per failure
 * streak and retries next tick; it never surfaces modal errors.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const git = (root: string, args: string[]) =>
  run("git", args, { cwd: root, timeout: 60_000 });

export class StoreSyncService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private syncing = false;
  private failedLastTick = false;

  constructor(
    private readonly storeRoot: string,
    private readonly log: (line: string) => void,
    private readonly intervalMs = 5 * 60_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync(), this.intervalMs);
    // One immediate pass so a restart never leaves yesterday's work dirty
    // for another five minutes.
    void this.sync();
  }

  /** One sync pass. Exposed for tests and for an explicit "sync now". */
  async sync(): Promise<"clean" | "synced" | "failed"> {
    if (this.syncing) return "clean";
    this.syncing = true;
    try {
      const { stdout } = await git(this.storeRoot, ["status", "--porcelain"]);
      const dirty = stdout.trim().length > 0;
      if (dirty) {
        await git(this.storeRoot, ["add", "-A"]);
        await git(this.storeRoot, [
          "commit",
          "-m",
          `space: autosync ${new Date().toISOString()}`,
        ]);
      }
      // Push even when the tree was clean: a prior tick may have committed
      // and failed to push, and unpushed commits are exactly the loss window
      // this service exists to close.
      const ahead = (
        await git(this.storeRoot, ["rev-list", "--count", "@{u}..HEAD"])
      ).stdout.trim();
      if (dirty || ahead !== "0") {
        await git(this.storeRoot, ["push"]);
        this.log(
          `━━ store autosync: ${dirty ? "committed and " : ""}pushed (${this.storeRoot})`,
        );
        this.failedLastTick = false;
        return "synced";
      }
      this.failedLastTick = false;
      return "clean";
    } catch (err) {
      if (!this.failedLastTick)
        this.log(
          `━━ store autosync FAILED (will retry each tick): ${err instanceof Error ? err.message : String(err)}`,
        );
      this.failedLastTick = true;
      return "failed";
    } finally {
      this.syncing = false;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
