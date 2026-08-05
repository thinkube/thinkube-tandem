/**
 * The engine-driven run, end to end over a REAL temporary git repo: the
 * DAG orders tests first, the fake worker writes a real probe and a real
 * implementation, the REAL closing gate (runAcVerifications → runBounded)
 * executes the probe, and the delivery carries honest proofs. Parking and
 * containment are covered at their seams.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { containmentViolations } from "./worker";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace, Space } from "../core/schema";
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

function spaceWithOneChange(): { space: Space; ids: string[] } {
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

test("a signed TEP runs through the engine: tests-first, real probe executed by the real gate, proofs honest", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-1" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const briefs: { role: string; text: string }[] = [];

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      spaceName: "greet space",
      worker: async (w, brief) => {
        briefs.push({ role: w.role, text: brief });
        if (w.role === "test") {
          const probe = w.footprint[0];
          const abs = path.join(w.worktree, probe);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(
            abs,
            `// WHY (INVARIANT): greet() must return the greeting the acceptance criterion names.\n` +
              `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
              `import { greet } from "../src/greet.mjs";\n` +
              `test("greet", () => assert.equal(greet(), "hello"));\n`,
          );
        } else {
          const abs = path.join(w.worktree, "src/greet.mjs");
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, `export function greet() { return "hello"; }\n`);
        }
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );

  assert.equal(briefs[0].role, "test", "tests-first: the probe author dispatched before the coder");
  assert.ok(briefs[0].text.includes("TEST AUTHOR"), "engine brief for the tester");
  assert.ok(briefs[1].text.includes("SERIAL unit"), "engine brief for the coder");
  assert.ok(briefs[1].text.includes("THE INTENT"), "the TEP body rides the brief as the north star");

  assert.ok(outcome.delivery, "a delivery exists");
  const probeProof = outcome.delivery!.proofs.find((p) => p.kind === "probe")!;
  assert.equal(probeProof.verdict, "green", "the REAL closing gate executed the probe");
  const suiteProof = outcome.delivery!.proofs.find((p) => p.kind === "suite")!;
  assert.equal(suiteProof.verdict, "green");
  assert.equal(outcome.undelivered.length, 0);
  const states = [...state.units.values()].map((u) => u.state);
  assert.ok(states.every((s) => s === "done"));
});

test("a red probe is a red proof — the delivery exists and says so", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-2" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          const abs = path.join(w.worktree, w.footprint[0]);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(
            abs,
            `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
              `test("fails", () => assert.equal(1, 2));\n`,
          );
        }
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  const probeProof = outcome.delivery!.proofs.find((p) => p.kind === "probe")!;
  assert.equal(probeProof.verdict, "red");
  assert.ok(probeProof.ref, "evidence rides the proof");
});

test("parked worker: the question surfaces, the answer resumes, UNDELIVERED is honest", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-3" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let seenAnswer: string | undefined;
  // Answer through the same door the run view uses, the moment the park lands.
  const origPark = state.park.bind(state);
  state.park = (id, q, answer) => {
    origPark(id, q, answer);
    setImmediate(() => state.answer(id, "hello"));
  };
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          const answer = await new Promise<string>((resolve) => w.onPark("which greeting?", resolve));
          seenAnswer = answer;
          return { ok: false, finalText: "UNDELIVERED: could not finish — question: which greeting?", undelivered: ["could not finish — question: which greeting?"] };
        }
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.equal(seenAnswer, "hello", "the answer flowed through the run view door");
  assert.ok(outcome.undelivered.some((u) => u.includes("could not finish")), "the gap is on the delivery, not hidden");
});

test("containment math: outside-footprint paths are violations; baseline is exempt", () => {
  const dirty = ["src/a.ts", "src/evil.ts", "probes/x.test.mjs", "pre-existing.txt"];
  const bad = containmentViolations(dirty, ["src/a.ts", "probes"], new Set(["pre-existing.txt"]));
  assert.deepEqual(bad, ["src/evil.ts"]);
});
