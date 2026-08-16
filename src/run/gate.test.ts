/**
 * The closing gate's promises, driven end to end through dispatchTep over a
 * real temporary repository: the repository's own suite decides, and a red
 * suite is never delivered — withheld before any work when the repository
 * is red already, withheld after the work when the work made it red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchTep } from "./dispatch";
import { RED_SUITE_REFUSAL } from "./gate";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { GREEN_PROBE, spaceWithOneChange, tmpRepo, writeInto } from "./runHarness";

test("a red suite after the work withholds the delivery, in intent terms — never handed over red", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-33" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      // Green on the untouched tree, red once the work exists: a standing check the work breaks.
      suiteCommand: ["node", "-e", "process.exit(require('fs').existsSync('src/greet.mjs') ? 1 : 0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.equal(outcome.delivery, undefined, "nothing is delivered red");
  assert.deepEqual(outcome.refusals, [RED_SUITE_REFUSAL]);
  assert.ok(!/\.(mjs|ts|js)\b/.test(RED_SUITE_REFUSAL), "the reason names no file — the human is not asked about internals");
});


test("a repository whose standing checks are red before any work refuses the run at the door", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-34" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let spent = 0;
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(1)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async () => {
        spent++;
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.equal(spent, 0, "no worker is spent on a repository that is red before the work");
  assert.match(outcome.refusals[0] ?? "", /red before any work/);
});
