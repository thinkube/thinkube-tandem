/**
 * Every worker the run starts can reach the door.
 *
 * The fence keeps two coders out of one file; the door is what makes it
 * livable — a path nobody owns and nobody is touching is granted, the
 * change stands, and the unit carries on. The guard consults it on every
 * write outside the footprint, but only `if (wanted.length && deps.clearFor)`.
 * Hand a worker no `clearFor` and that line is a no-op: there is no grant to
 * be had, so every uncleared write is restored at once and the second one
 * kills the unit.
 *
 * Which is what shipped. The run builds its worker arguments by hand at two
 * call sites, and only the second — the check-authoring continuation —
 * carried the door. Every ordinary coder and tester ran without it. In one
 * run three units hit the fence, not one was granted anything, no ruling
 * was logged for any of them, and SL-18 was failed for a change it was
 * entitled to make: it had written it, been restored, worked out for itself
 * that the pre-flight's note was not a grant, and written again to raise the
 * need. The door it was waiting on was never there.
 *
 * Duplication is the fault, so this reads both call sites rather than one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/** The run's own source. Read from the repository, not from beside this
 *  file: compiled, `__dirname` is out-test/run, where no .ts lives. */
const src = path.resolve(__dirname, "..", "..", "src", "run");
const from = (name: string): string =>
  fs.readFileSync(fs.existsSync(path.join(src, name)) ? path.join(src, name) : path.join(__dirname, name), "utf8");
const dispatch = from("dispatch.ts");

test("every worker the run starts is handed the clearance door", () => {
  // A worker is started by calling `worker(...)`; each call is one actor
  // whose writes the guard will judge. Counting doors across the file is
  // the wrong instrument — the gate hands one to its repairing authors too,
  // which is not a worker call site. Each site is checked for its own.
  const starts = [...dispatch.matchAll(/\bworker\(\s*\n?\s*\{/g)];
  assert.ok(starts.length >= 2, `expected the run's worker call sites, found ${starts.length}`);

  const without = starts
    .map((m, i) => {
      const from = m.index ?? 0;
      const to = i + 1 < starts.length ? (starts[i + 1].index ?? dispatch.length) : dispatch.length;
      return { line: dispatch.slice(0, from).split("\n").length, args: dispatch.slice(from, to) };
    })
    .filter((site) => !/clearFor:/.test(site.args))
    .map((site) => `dispatch.ts:${site.line}`);

  assert.deepEqual(
    without,
    [],
    "a worker started without the door cannot be granted anything, and its second uncleared write kills it",
  );
});

test("the guard only asks the door when it was given one", () => {
  const guard = from("worker.ts");
  assert.match(
    guard,
    /if \(wanted\.length && deps\.clearFor\)/,
    "the guard's own condition — the reason a missing door is silent rather than loud",
  );
});
