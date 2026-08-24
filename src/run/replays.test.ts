/**
 * Every plan the machine ever dispatched, re-judged by the door it has now.
 *
 * The loop that fixes this machinery had one signal: run the whole thing
 * and see. That is an hour, real spend, and one fault per attempt — slow
 * enough that a fix and the regression it introduced are indistinguishable
 * until the next morning. Two nights were lost that way, to faults that
 * were decidable from the plan alone before any worker started.
 *
 * A plan is now kept with its run. This drive reads every one of them and
 * asks the door what it would say today. It takes milliseconds, it needs
 * no model and no worktree, and a rule that would have refused a plan the
 * machine really ran says so the moment the rule is written.
 *
 * The plans live under `fixtures/plans`. A repository with none simply has
 * nothing to replay — the drive passes, and grows teeth as runs happen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { refusedBeforeDispatch } from "./refusals";
import { rehouseChecks } from "./checkHomes";
import { emptySpace } from "../core/schema";
import type { PlanRecord } from "./record";

// __dirname is this compiled test's own directory under out-test/src/run/,
// mirroring its source location under src/run/ — one more ".." than the
// source's own depth reaches fixtures/plans from there.
const PLANS = path.join(__dirname, "..", "..", "..", "fixtures", "plans");

/** A recorded plan, with what the door needs around it. */
interface Fixture {
  name: string;
  /** What the door must say: phrases the refusal has to contain, or
   *  `false` for a plan that must be allowed to run. */
  expect: { refused: string[] } | { refused: false };
  /** Order the door must have derived and added itself: the later slice,
   *  and a handle of the one it now waits for. */
  ordered?: { after: string; waitsFor: string }[];
  plan: PlanRecord[];
  /** The map, as file → the files it uses. */
  uses?: Record<string, string[]>;
  /** Files the repository holds, for the test idiom and for addresses taken. */
  repoFiles?: string[];
}

function fixtures(): Fixture[] {
  if (!fs.existsSync(PLANS)) return [];
  return fs
    .readdirSync(PLANS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ ...(JSON.parse(fs.readFileSync(path.join(PLANS, f), "utf8")) as Fixture), name: f }));
}

/** The plan as the door reads it. */
function slicesOf(plan: PlanRecord[]): unknown[] {
  return plan.map((s) => ({
    handle: s.handle,
    status: "ready",
    files: s.units.flatMap((u) => u.footprint),
    workUnits: s.units.map((u) => ({
      footprint: [...u.footprint],
      execution: "serial",
      role: u.role ?? "code",
      ...(u.consumes?.length ? { consumes: [...u.consumes] } : {}),
    })),
    ...(s.criterionIds?.length ? { criterionIds: [...s.criterionIds] } : {}),
  }));
}

/** A map file the door can read, written where the fixture's own run had one. */
function mapFor(uses: Record<string, string[]> | undefined, dir: string): string | undefined {
  if (!uses || !Object.keys(uses).length) return undefined;
  const files = [...new Set([...Object.keys(uses), ...Object.values(uses).flat()])];
  const id = (f: string): string => f.replace(/[^\w]/g, "_");
  const at = path.join(dir, "graph.json");
  fs.writeFileSync(
    at,
    JSON.stringify({
      nodes: files.map((f) => ({ id: id(f), source_file: f })),
      links: Object.entries(uses).flatMap(([from, tos]) =>
        tos.map((to) => ({ relation: "imports", source: id(from), target: id(to), source_file: from })),
      ),
    }),
  );
  return at;
}

for (const fx of fixtures())
  test(`the door still judges ${fx.name} the way it must`, async () => {
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "tandem-replay-"));
    const slices = slicesOf(fx.plan);
    // The plan is rehoused first, exactly as the run does it, so a fault in
    // where checks are born is a fault this drive sees.
    rehouseChecks(slices as never, fx.repoFiles ?? []);
    const homes = slices.flatMap((s) =>
      (s as { workUnits: { role?: string; footprint: string[] }[] }).workUnits
        .filter((u) => u.role === "test")
        .flatMap((u) => u.footprint),
    );
    assert.equal(new Set(homes).size, homes.length, `two checks share an address: ${homes.join(" ")}`);

    const graphPath = mapFor(fx.uses, dir);
    const r = await refusedBeforeDispatch({
      slices: slices as never,
      space: emptySpace() as never,
      cut: { id: "cut-replay", changeIds: [] } as never,
      repoRoot: dir,
      ...(graphPath ? { graphPath } : {}),
      exec: async () => ({ code: 0, out: "" }),
      log: () => {},
    });
    if (fx.expect.refused === false) {
      assert.equal(r.refusal, undefined, `refused a plan that must run: ${r.refusal?.refusal}`);
      for (const want of fx.ordered ?? []) {
        const later = r.dag.filter((u) => u.slice === want.after && u.role !== "test");
        assert.ok(
          later.some((u) => u.requires.some((x) => x.startsWith(want.waitsFor))),
          `${want.after} does not wait for ${want.waitsFor}: ${JSON.stringify(later.map((u) => u.requires))}`,
        );
      }
      return;
    }
    assert.ok(r.refusal, "a plan that must be refused was let through");
    for (const words of fx.expect.refused)
      assert.ok(r.refusal!.refusal.includes(words), `the refusal no longer says "${words}":\n${r.refusal!.refusal}`);
  });

test("the replay drive has plans to replay", () => {
  // A drive over an empty directory passes forever and proves nothing. It
  // says so instead: the plans arrive from real runs, and until one has
  // been recorded this is the only thing this file can honestly assert.
  const found = fixtures().length;
  assert.ok(found >= 1, "no recorded plan under fixtures/plans — nothing is being replayed");
});
