/**
 * The multirepo run (§7quater) over REAL repositories: one TEP produces
 * one branch and one delivery per repo, the producer scope dispatches
 * first, and an in-flight run's lock refuses colliding footprints with
 * the collision named.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-run-"));
  const g = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", dir], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "seed"]);
  return dir;
}

const GREEN_PROBE =
  `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
  `import { greet } from "../src/greet.mjs";\n` +
  `test("greet", () => assert.equal(greet(), "hello"));\n`;

function writeInto(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function spaceWithOneChange() {
  let s = emptySpace();
  const a = addAsk(s, "greet the user", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module returning a greeting",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, ids: [n.added.id] };
}

test("multirepo TEP: one branch and one delivery PER REPO, producer scope first, unit ids scope-qualified", async () => {
  const anchorRepo = tmpRepo();
  const memberRepo = tmpRepo();
  let s = emptySpace();
  const a = addAsk(s, "the shared type and its consumer", "t");
  assert.ok(a.ok);
  s = a.space;
  const n1 = addNode(s, {
    sentence: "the shared greeting module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n1.ok);
  s = n1.space;
  const n2 = addNode(s, {
    sentence: "the member consumer module",
    serves: [a.added.id],
    needs: [n1.added.id],
    acceptance: [{ id: "c2", text: "consume() returns 'ok'" }],
    grounding: {
      touchpoints: [{ path: "src/consume.mjs", planned: true, scope: "member-x1" }],
      stamp: [],
    },
  });
  assert.ok(n2.ok);
  s = n2.space;

  const { TandemSession } = await import("../surfaces/session");
  const { mintApproval, approvalContentHash } = await import("../engine/approvalToken");
  void mintApproval;
  void approvalContentHash;
  const dispatchedRepos: string[] = [];
  const session = new TandemSession({
    round: { model: "sonnet", repoRoot: anchorRepo },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => new Date().toISOString(),
    author: "t",
    classify: async () => "ask" as const,
    readCurrentStamp: async () => [],
    forge: { openDelivery: async () => "", merge: async () => {} },
    scope: { gitRoot: anchorRepo, prefix: "", projectId: "proj-1", label: "P" },
    resolveScope: async (id: string) =>
      id === "member-x1" ? { gitRoot: memberRepo, prefix: "" } : undefined,
    ground: async () => ({ changes: [], questions: [] }),
    dispatch: (async (deps: never, space: never, cut: never, slices: never) => {
      dispatchedRepos.push((deps as { repoRoot: string }).repoRoot);
      return dispatchTep(
        {
          ...(deps as object),
          supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
          worker: async (w: Parameters<NonNullable<Parameters<typeof dispatchTep>[0]["worker"]>>[0]) => {
            if (w.role === "test") {
              const isMember = w.worktree.includes(path.basename(memberRepo));
              writeInto(
                w.worktree,
                w.footprint[0],
                isMember
                  ? `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { consume } from "../src/consume.mjs";\ntest("c", () => assert.equal(consume(), "ok"));\n`
                  : GREEN_PROBE,
              );
            } else if (w.worktree.includes(path.basename(memberRepo))) {
              writeInto(w.worktree, "src/consume.mjs", `export function consume() { return "ok"; }\n`);
            } else {
              writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
            }
            return { ok: true, finalText: "done" };
          },
        } as never,
        space,
        cut,
        slices,
      );
    }) as never,
  } as never);
  session.space = s;
  session.toggleCut([n1.added.id, n2.added.id]);
  const signed = session.signCut();
  assert.ok(signed.ok, `sign: ${JSON.stringify(signed)}`);
  // signCut fires execute asynchronously; wait for it to drain.
  for (let i = 0; i < 600 && session.running; i++) await new Promise((r) => setTimeout(r, 100));

  assert.deepEqual(dispatchedRepos, [anchorRepo, memberRepo], "producer scope dispatched first");
  assert.equal(session.space.deliveries.length, 2, "one delivery per repo");
  const ids = session.space.deliveries.map((d) => d.id).sort();
  assert.ok(ids[1].endsWith("-member-x1"), "the member delivery carries its scope");
  const anchorTree = execFileSync("git", ["-C", anchorRepo, "ls-tree", "-r", "--name-only", "tandem/proj-1/TEP-t-1"], { encoding: "utf8" });
  const memberTree = execFileSync("git", ["-C", memberRepo, "ls-tree", "-r", "--name-only", "tandem/proj-1/TEP-t-1"], { encoding: "utf8" });
  assert.ok(anchorTree.includes("src/greet.mjs"), "anchor repo carries its change");
  assert.ok(memberTree.includes("src/consume.mjs"), "member repo carries its change");
});

test("dispatch refuses when footprints collide with an in-flight run on the same repository", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-11" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const locksDir = path.join(path.dirname(repo), `${path.basename(repo)}-worktrees`, "locks");
  fs.mkdirSync(locksDir, { recursive: true });
  // The lock names a process that is genuinely alive (this test runner) —
  // a lock whose writer is gone no longer blocks anything.
  fs.writeFileSync(
    path.join(locksDir, "other-run.json"),
    JSON.stringify({
      runName: "otherproj/TEP-x-9",
      footprints: ["src/greet.mjs"],
      pid: process.pid,
    }),
  );
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
      worker: async () => ({ ok: true, finalText: "done" }),
    },
    space,
    cut,
    slices,
  );
  assert.ok(outcome.refusals.length === 1, "refused");
  assert.ok(outcome.refusals[0].includes("otherproj/TEP-x-9"), "the collision names the in-flight run");
  assert.ok(outcome.refusals[0].includes("src/greet.mjs"), "and the overlapping path");
});
