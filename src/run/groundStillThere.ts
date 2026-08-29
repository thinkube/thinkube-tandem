/**
 * Whether the ground a cut was written against is still under it.
 *
 * A promise is grounded on files and symbols that existed when it was
 * derived: "this lands in `src/panel.ts`, on `reveal`". Between the
 * derivation and the run, or in the middle of the run, somebody commits an
 * urgent fix with no ask behind it — and the file moves, or the symbol is
 * renamed, or the module is deleted outright.
 *
 * The run does not notice. It resumes the branch, merges the new base
 * commits, repairs the conflict, and carries on dispatching workers
 * against facts that are gone. The tester writes checks for a symbol that
 * no longer exists; the coder is told to change a file nobody has; every
 * check goes red for a reason no worker can act on, and the promises come
 * back unkept.
 *
 * There is nothing to guess here. The grounding says what it expects, and
 * the tree either has it or does not. A promise whose ground moved cannot
 * be built as written — it has to be grounded again, which is a change to
 * what was asked and belongs to the person.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Cut, Space } from "../core/schema";

export interface Moved {
  /** The promise, in the person's own words. */
  promise: string;
  /** What it expected to find and did not. */
  missing: string[];
}

/**
 * The promises of this cut whose ground is no longer there.
 *
 * A `planned` anchor is exempt: it names a file this very cut will create,
 * so its absence is the normal state before any work starts. Everything
 * else was seen by the grounding round in a file it had open.
 */
export async function groundThatMoved(a: {
  worktree: string;
  space: Space;
  cut: Cut;
}): Promise<Moved[]> {
  const wanted = new Set(a.cut.changeIds);
  const out: Moved[] = [];
  for (const n of a.space.nodes) {
    if (!wanted.has(n.id)) continue;
    const missing: string[] = [];
    for (const t of n.grounding?.touchpoints ?? []) {
      if (t.planned) continue;
      const there = await fs
        .access(path.join(a.worktree, t.path))
        .then(() => true)
        .catch(() => false);
      if (!there) missing.push(t.symbol ? `${t.path} (${t.symbol})` : t.path);
    }
    if (missing.length) out.push({ promise: n.sentence, missing: [...new Set(missing)] });
  }
  return out;
}

/**
 * What the person is told, when it happens.
 *
 * Not "the run failed". The ask was written against code that has since
 * changed, and only the person can say what it should say now — so the
 * message names the promise, names what is gone, and asks for the one
 * thing that can settle it.
 */
export function regroundingNeeded(moved: readonly Moved[]): string {
  return (
    `${moved.length} promise(s) of this cut are grounded on code that is no longer in the tree — ` +
    `changed since the cut was written, by work with no ask behind it. They cannot be built as ` +
    `written, and no worker can discover that on its own. Ground them again against the code as ` +
    `it stands, then sign:\n` +
    moved.map((m) => `  · "${m.promise}" expects ${m.missing.join(", ")}`).join("\n")
  );
}
