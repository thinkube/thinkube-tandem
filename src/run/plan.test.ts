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

test("a tester that stops short is continued from where it stopped — its written probes stay, the missing ones are named, the unit is not failed", async () => {
  const repo = tmpRepo();
  let s = emptySpace();
  const a = addAsk(s, "greet twice", "t");
  if (!a.ok) throw new Error("ask");
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module",
    serves: [a.added.id],
    needs: [],
    acceptance: [
      { id: "c1", text: "greet() returns 'hello'" },
      { id: "c2", text: "greet() is a function" },
    ],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  if (!n.ok) throw new Error("node");
  s = n.space;
  const cut = { id: "cut-1", changeIds: [n.added.id], tepId: "TEP-t-61" };
  const slices = tepSlices({ space: s, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const briefs: string[] = [];
  let testerRounds = 0;
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        if (w.role === "test") {
          testerRounds++;
          briefs.push(brief);
          // Round one writes only the first probe and ends; the continuation writes the rest.
          const todo = testerRounds === 1 ? [w.footprint[0]] : w.footprint.filter((f) => !fs.existsSync(path.join(w.worktree, f)));
          for (const f of todo) writeInto(w.worktree, f, GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    s,
    cut,
    slices,
  );
  assert.equal(testerRounds, 2, "one continuation");
  assert.match(briefs[1], /CONTINUE/);
  assert.match(briefs[1], /STILL TO WRITE/);
  assert.equal(state.view().units.find((u) => u.role === "test")?.state, "done");
  assert.ok(outcome.delivery, "and the run delivers");
});
