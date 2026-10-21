/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A run's door takes readiness's proof of the setup when it is about the
 * same commit and the same setup facts, and proves the setup again when
 * anything differs. Readiness keeps its answer in the store; the run reads
 * it from there, as it does from its own process.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { checkReadiness, readinessNow } from "./readiness";
import { whatWeKnow } from "./whatWeKnow";
import { emptySpace } from "../core/schema";
import { RunState } from "./state";
import { setupFactsOf, takeSetupProof, type SetupProof } from "./setupProof";

const TOLD = { provision: "install-it", prepare: "", runOne: "one <file>", build: "build-it" };

/** A repository with one test of its own, so the single-test command has
 *  something to be proved on. */
function repository(): { dir: string; storeRoot: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-door-ready-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(dir, "src", "a.test.js"), "require('./a');\n");
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "base"]);
  return { dir, storeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-door-store-")) };
}

const exec = async (cmd: string, args: string[], cwd: string) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

/** Every command a door runs, answered as if it held. */
function commands(): { ran: string[]; boundedExec: (cmd: string) => Promise<{ code: number; output: string }> } {
  const ran: string[] = [];
  return { ran, boundedExec: async (cmd: string) => (ran.push(cmd), { code: 0, output: "ok 1 - held" }) };
}

/** The run's door, on the repository itself as its tree. */
async function door(dir: string, setupProven?: (root: string) => SetupProof | undefined) {
  const { ran, boundedExec } = commands();
  const said: string[] = [];
  const known = await whatWeKnow({
    deps: {
      repoRoot: dir,
      state: new RunState(() => {}),
      spaceName: "s",
      model: "test",
      told: { provision: TOLD.provision, runOne: TOLD.runOne, build: TOLD.build, suite: "suite-it" },
      ...(setupProven ? { setupProven } : {}),
    } as never,
    worktree: dir,
    tep: "TEP-1",
    space: emptySpace(),
    cut: { id: "cut-1", tepId: "TEP-1", changeIds: [] },
    resumed: false,
    halted: () => false,
    exec,
    boundedExec,
    log: (l) => said.push(l),
    defect: () => {},
  });
  return { known, ran, said };
}

/** Readiness, answered and kept in the store, and the proof the run reads back. */
async function ready(dir: string, storeRoot: string) {
  const home = { storeRoot, repoId: "repo-1" };
  const { ran, boundedExec } = commands();
  const r = await checkReadiness({ repoRoot: dir, home, boundedExec, reading: TOLD });
  const setup = r.items.find((i) => i.name === "setup");
  assert.ok(setup?.ready, `readiness proved the setup: ${setup?.say}`);
  assert.ok(ran.includes("build-it"), `readiness ran the build: ${ran.join(" · ")}`);
  return (root: string) => readinessNow(home, root)?.setupProof;
}

test("a run at the commit readiness proved takes its proof and does not prove the setup again", async () => {
  const { dir, storeRoot } = repository();
  const proven = await ready(dir, storeRoot);
  const { known, ran, said } = await door(dir, proven);
  assert.ok(known.ok, JSON.stringify(known));
  assert.ok(said.some((l) => /readiness proved the setup of [0-9a-f]{8}.*takes its proof/.test(l)), said.join("\n"));
  assert.ok(ran.includes("install-it"), `the tree is still installed for the workers: ${ran.join(" · ")}`);
  assert.ok(!ran.includes("build-it"), `the product build is not proved again: ${ran.join(" · ")}`);
  assert.ok(!ran.some((c) => c.startsWith("one ")), `the single-test command is not proved again: ${ran.join(" · ")}`);
  assert.ok(!ran.includes("suite-it"), `the suite is not proved again: ${ran.join(" · ")}`);
  if (known.ok) {
    assert.equal(known.deps.build, "build-it", "the product build readiness proved reaches the run");
    assert.equal(known.runOne, "one <file>", "and the single-test command");
  }
});

test("changed setup facts prove the setup again", async () => {
  const { dir, storeRoot } = repository();
  // The store finds an answer under the facts as they are, so the proof
  // kept before they changed is handed over directly: the door refuses it.
  const kept = (await ready(dir, storeRoot))(dir);
  assert.ok(kept, "readiness kept a proof");
  fs.mkdirSync(path.join(dir, ".tandem"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".tandem", "setup.json"), JSON.stringify({ provision: "install-it", prepare: "", runOne: "one <file>" }));
  const { ran, said } = await door(dir, () => kept);
  assert.ok(said.some((l) => /proving the setup on this tree: the setup facts/.test(l)), said.join("\n"));
  assert.ok(ran.includes("build-it"), `the product build is proved again: ${ran.join(" · ")}`);
});

test("another commit proves the setup again", async () => {
  const { dir, storeRoot } = repository();
  const proven = await ready(dir, storeRoot);
  const kept = proven(dir);
  assert.ok(kept, "readiness kept a proof");
  fs.writeFileSync(path.join(dir, "src", "b.js"), "module.exports = 2;\n");
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "next"]);
  const { ran, said } = await door(dir, () => kept);
  assert.ok(said.some((l) => /proving the setup on this tree: readiness proved [0-9a-f]{8}, and the run starts at/.test(l)), said.join("\n"));
  assert.ok(ran.includes("build-it"), `the product build is proved again: ${ran.join(" · ")}`);
  assert.ok(ran.some((c) => c.startsWith("one ")), `and the single-test command: ${ran.join(" · ")}`);
});

test("a tree resumed from a branch with commits proves the setup again", async () => {
  const { dir, storeRoot } = repository();
  const kept = (await ready(dir, storeRoot))(dir);
  const answer = takeSetupProof(kept, {
    head: kept!.head,
    facts: setupFactsOf(dir),
    told: kept!.told,
    resumed: true,
  });
  assert.ok("why" in answer && /resumes a branch/.test(answer.why), JSON.stringify(answer));
});
