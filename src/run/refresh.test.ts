import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { committedSlicesOf } from "./refresh";
import { GREEN_PROBE, spaceWithOneChange, tmpRepo, writeInto } from "./runHarness";

test("the branch's own log names what an earlier run committed", () => {
  const log = ["tandem: TEP-9 SL-2", "tandem: deliver TEP-9", "tandem: TEP-9 SL-1", "tandem: TEP-8 SL-1", "seed"].join("\n");
  assert.deepEqual(committedSlicesOf(log, "TEP-9"), ["SL-2", "SL-1"]);
});

test("Run again is a resume: the branch is kept, the base's new commits merge in, committed slices and probes stand, and only the unfinished work runs", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-77" };
  const mkDeps = (worker: Parameters<typeof dispatchTep>[0]["worker"], state: RunState) => ({
    repoRoot: repo,
    model: "sonnet",
    suiteCommand: ["node", "-e", "process.exit(0)"] as string[],
    state,
    supervisorRound: async () => null,
    rehome: async () => ({ anchors: [], notes: [] }),
    spaceName: "greet space",
    worker,
  });

  // First run: the tester writes the probe; the coder fails — the slice does not commit.
  const s1 = new RunState(() => {});
  await dispatchTep(
    mkDeps(async (w) => {
      if (w.role === "test") {
        writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
        return { ok: true, finalText: "done" };
      }
      return { ok: false, finalText: "UNDELIVERED: could not build it" , undelivered: ["could not build it"] };
    }, s1),
    space,
    cut,
    tepSlices({ space, cut, spaceName: "greet space" }),
  );
  assert.equal(s1.units.get("SL-1#eu-0")?.state, "failed", "first run: the coder failed");

  // The base moves between runs — an unrelated tool fix.
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "note.md"), "an unrelated base change\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "base moved between runs"]);

  // Second run: no tester runs (its probe stands); only the coder works.
  const s2 = new RunState(() => {});
  const roles: string[] = [];
  const outcome2 = await dispatchTep(
    mkDeps(async (w) => {
      roles.push(w.role + ":" + w.footprint[0]);
      assert.equal(w.role, "code", "only the coder runs — the tester's probe stands");
      assert.ok(fs.existsSync(path.join(w.worktree, "docs", "note.md")), "the resumed tree carries the base's new commit");
      writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
      return { ok: true, finalText: "done" };
    }, s2),
    space,
    cut,
    tepSlices({ space, cut, spaceName: "greet space" }),
  );
  assert.equal(roles.length, 1, "exactly one worker ran on the resume");
  assert.equal(s2.units.get("SL-1#eu-1")?.state, "done", "the standing tester is done on the record");
  assert.ok(outcome2.delivery && !outcome2.delivery.withheld, "the resumed run delivers");
  assert.ok(s2.logs.some((l) => /resuming the existing branch — merging 1 new base commit/.test(l)), "the refresh is said");

  // Third run: everything stands — no worker runs at all; the gate re-proves and delivers.
  const s3 = new RunState(() => {});
  const outcome3 = await dispatchTep(
    mkDeps(async () => {
      throw new Error("nothing should run — every slice stands");
    }, s3),
    space,
    cut,
    tepSlices({ space, cut, spaceName: "greet space" }),
  );
  assert.ok(outcome3.delivery && !outcome3.delivery.withheld, "a fully standing cut goes straight to the gate and delivers");
  assert.ok(s3.logs.some((l) => /standing from the earlier run: SL-1/.test(l)));
});

test("a conflicting base move is resolved inside the run before dispatch, on the record", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  // The cut's promise lands in a file that ALREADY exists on the base.
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "greet.mjs"), `export function greet() { return "old"; }\n`);
  g(["add", "-A"]);
  g(["commit", "-qm", "greet exists"]);
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-78" };
  const s1 = new RunState(() => {});
  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state: s1,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        const reply = await w.verifyTool!();
        if (!/1\/1 pass/.test(reply)) return { ok: false, finalText: reply };
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    tepSlices({ space, cut, spaceName: "greet space" }),
  );
  assert.equal(s1.units.get("SL-1#eu-0")?.state, "done", "first run delivered the slice");
  // The base rewrites the same line the branch changed — a true conflict.
  fs.writeFileSync(path.join(repo, "src", "greet.mjs"), `export function greet() { return "base moved"; }\n`);
  g(["add", "-A"]);
  g(["commit", "-qm", "base rewrites greet"]);
  const s2 = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state: s2,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        assert.match(brief, /resolving a git merge conflict/, "the only worker is the conflict repair");
        assert.deepEqual(w.footprint, ["src/greet.mjs"]);
        // Both intents survive: the branch's behavior is the signed work.
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "resolved" };
      },
    },
    space,
    cut,
    tepSlices({ space, cut, spaceName: "greet space" }),
  );
  assert.ok(s2.logs.some((l) => /the base moved into 1 file\(s\) this cut also changed/.test(l)));
  assert.ok(s2.logs.some((l) => /the merge conflict was resolved inside the run and committed/.test(l)));
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the resumed run delivers after the resolution");
});
