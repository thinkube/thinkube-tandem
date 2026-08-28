/**
 * A space open in the editor follows what is written to it, whoever wrote.
 *
 * The store is append-only and the state is a fold over its records, so a
 * second writer — a server acting on the person's behalf, a run started
 * from the command line, the same space open on another machine after a
 * sync — leaves a complete, readable trail. What was missing is anybody
 * reading it: the session folded the records once, when the space opened,
 * and thereafter only ever wrote outward. Work done anywhere else was
 * invisible until the space was closed and opened again.
 *
 * v1 had this and it is why a person could watch the board fill in while
 * the machine worked. The records directory is watched, the fold is read
 * again, and the surface is pushed — the same path the space already takes
 * when it opens.
 */
import type * as vscodeTypes from "vscode";

/** What this needs of a session: fold the records again, and say whether
 *  it is mid-flight. Kept narrow so the watcher is testable without one. */
export interface Followable {
  load(): void;
  readonly activity: unknown;
  readonly running: unknown;
}

/**
 * Whether an outside write should be folded in right now.
 *
 * Never mid-flight: a round in progress holds state in memory that the
 * records do not have yet, and re-folding underneath it would discard the
 * very work being done. The write is not lost — it is on disk, and the
 * next quiet moment picks it up.
 */
export function shouldFollow(s: Followable): boolean {
  return !s.activity && !s.running;
}

/**
 * Follow a space's records. Returns a disposer.
 *
 * Debounced, because one act appends one record but a burst of grounding
 * rounds appends many, and re-folding per file would redraw the surface
 * faster than a person can read it.
 */
function followSpace(
  vs: typeof vscodeTypes,
  args: { storeDir: string; session: Followable; onReloaded: () => void; quietMs?: number },
): { dispose(): void } {
  const pattern = new vs.RelativePattern(args.storeDir, "records/*.json");
  const watcher = vs.workspace.createFileSystemWatcher(pattern, false, false, true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!shouldFollow(args.session)) return;
      args.session.load();
      args.onReloaded();
    }, args.quietMs ?? 400);
  };
  watcher.onDidCreate(settle);
  watcher.onDidChange(settle);
  return {
    dispose(): void {
      if (timer) clearTimeout(timer);
      watcher.dispose();
    },
  };
}

/** One watch per open space, replacing any it had. The map is the caller's
 *  so a window that closes a space can drop its watch with it. */
export function followFor(
  vs: typeof vscodeTypes,
  watches: Map<string, { dispose(): void }>,
  key: string,
  args: { storeDir: string; session: Followable; onReloaded: () => void },
): void {
  watches.get(key)?.dispose();
  watches.set(key, followSpace(vs, args));
}
