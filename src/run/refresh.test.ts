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

test("a widened footprint rides the slice's commit, and a half-committed branch is mended on resume before dispatch", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  // A base file whose type the cut's work must widen — the sessionDeps shape.
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "deps.mjs"), `export function onChanged(...args) { return args.slice(0, 1); }\n`);
  // The repository's build step proves CONSISTENCY: once a caller exists,
  // deps must accept what the caller passes. Green on the untouched base.
  fs.writeFileSync(
    path.join(repo, "check.mjs"),
    `import * as fs from "node:fs";\n` +
      `if (fs.existsSync("./src/greet.mjs")) {\n` +
      `  const { greet } = await import("./src/greet.mjs");\n` +
      `  if (greet().length !== 2) { console.error("src/deps.mjs(1,1): callers pass (key, message)"); process.exit(1); }\n` +
      `}\n`,
  );
  g(["add", "-A"]);
  g(["commit", "-qm", "base"]);
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-79" };
  const prepare = "node check.mjs";

  // First run: the coder gets deps.mjs by widening and finishes green —
  // but we simulate the OLD defect by having committed only the plan's
  // files: we run with a worker that writes both, then strip the widened
  // file's change from the branch to reproduce the half-committed state.
  const s1 = new RunState(() => {});
  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      prepare,
      state: s1,
      supervisorRound: async (_d, prompt) =>
        prompt.includes("THE WORKER'S QUESTION") ? "WIDEN: src/deps.mjs — the callers pass (key, message)" : null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          writeInto(
            w.worktree,
            w.footprint[0],
            `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
              `import { greet } from "../src/greet.mjs";\ntest("greet", () => assert.equal(greet().length, 2));\n`,
          );
          return { ok: true, finalText: "done" };
        }
        await new Promise<string>((resolve) => w.onPark("need src/deps.mjs — widen?", resolve));
        writeInto(w.worktree, "src/greet.mjs", `import { onChanged } from "./deps.mjs";\nexport function greet() { return onChanged("k", "m"); }\n`);
        writeInto(w.worktree, "src/deps.mjs", `export function onChanged(key, message) { return [key, message]; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    tepSlices({ space, cut, spaceName: "greet space" }),
  );
  assert.equal(s1.units.get("SL-1#eu-0")?.state, "done");
  // The widened file rode the commit (the fix): the branch holds both halves.
  const branchDeps = execFileSync("git", ["-C", repo, "show", `${branchOf(repo)}:src/deps.mjs`], { encoding: "utf8" });
  assert.match(branchDeps, /key, message/, "the widened file rode the slice's commit");

  // Reproduce the OLD half-committed state: revert deps.mjs on the branch only.
  execFileSync("git", ["-C", repo, "worktree", "remove", "--force", path.join(path.dirname(repo), `${path.basename(repo)}-worktrees`, cut.tepId!)]);
  execFileSync("git", ["-C", repo, "worktree", "prune"]);
  const wt = fs.mkdtempSync(path.join(repo, "..", "half-"));
  execFileSync("git", ["-C", repo, "worktree", "add", wt, branchOf(repo)]);
  fs.writeFileSync(path.join(wt, "src", "deps.mjs"), `export function onChanged(...args) { return args.slice(0, 1); }\n`);
  execFileSync("git", ["-C", wt, "commit", "-aqm", "simulate: the widened half never committed"]);
  execFileSync("git", ["-C", repo, "worktree", "remove", "--force", wt]);

  // Resume: the standing tree does not build; the mend repairs it before dispatch.
  const s2 = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      prepare,
      state: s2,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        assert.match(brief, /does not compile — an earlier run\s+committed half of a change/, "the only worker is the mend");
        assert.ok(w.footprint.includes("src/deps.mjs"), "the compiler's own words scope it");
        writeInto(w.worktree, "src/deps.mjs", `export function onChanged(key, message) { return [key, message]; }\n`);
        return { ok: true, finalText: "mended" };
      },
    },
    space,
    cut,
    tepSlices({ space, cut, spaceName: "greet space" }),
  );
  assert.ok(s2.logs.some((l) => /the resumed branch does not build — a repair mends it/.test(l)));
  assert.ok(s2.logs.some((l) => /the standing tree builds again — mended and committed/.test(l)));
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the resume delivers after the mend");
});

function branchOf(repo: string): string {
  const out = execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/tandem/"], { encoding: "utf8" });
  return out.trim().split("\n")[0].trim();
}
