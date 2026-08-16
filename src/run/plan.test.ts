/**
 * The plan-side obligations proved through the run: a documentation
 * touchpoint that never lands is UNDELIVERED on the delivery, and a
 * delivered confession marker is UNDELIVERED on its face — both read from
 * the delivered tree at the gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace, Space } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { GREEN_PROBE, spaceWithOneChange, tmpRepo, writeInto } from "./runHarness";

test("docs gate: a slice declaring a docs/ touchpoint that never lands is UNDELIVERED on the delivery", async () => {
  const repo = tmpRepo();
  let s = emptySpace();
  const a = addAsk(s, "document the greeting", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a guide page for the greeting",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the guide exists" }],
    grounding: {
      touchpoints: [{ path: "docs/guide.md", planned: true }],
      stamp: [],
    },
  });
  assert.ok(n.ok);
  const cut = { id: "cut-1", changeIds: [n.added.id], tepId: "TEP-t-7" };
  const slices = tepSlices({ space: n.space, cut, spaceName: "docs space" });
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "docs space",
      worker: async (w) => {
        // The probe passes trivially; the coder never writes the guide.
        if (w.role === "test")
          writeInto(
            w.worktree,
            w.footprint[0],
            `import { test } from "node:test";\ntest("t", () => {});\n`,
          );
        return { ok: true, finalText: "done" };
      },
    },
    n.space,
    cut,
    slices,
  );
  assert.ok(
    outcome.undelivered.some((u) => u.includes("docs obligation unmet")),
    "the engine's docs gate speaks on the delivery",
  );
});


test("the honesty scan: a delivered confession marker is UNDELIVERED on the delivery's face", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-9" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
        else
          writeInto(
            w.worktree,
            "src/greet.mjs",
            `// !DEFERRAL_T!: handle non-English greetings\nexport function greet() { return "hello"; }\n`.replace("!DEFERRAL_T!", "TO" + "DO"),
          );
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.ok(
    outcome.undelivered.some((u) => u.includes("confesses a deferral")),
    "the confession surfaced as UNDELIVERED, not a footnote",
  );
});
