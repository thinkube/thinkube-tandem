// AC-4 (TRANSITION): proves the once-only TEP threading survives into a
// REWORK brief (attempt 2+), not just the first attempt — a wrong first
// implementation routes a rework whose brief must still carry the TEP
// heading and asks section exactly once, since the rework brief is the
// base brief plus an appended REWORK stanza, not a fresh render. Its job is
// done once dispatch.ts's once-only fix covers every attempt.
//
// Public interface under test: src/run/dispatch.ts -> dispatchTep(deps, space, cut, slices).
// Compiled by the shared `npm test` step (tsc -p tsconfig.test.json) into
// out-test/, then required here through Node's CJS/ESM bridge so this probe
// can run standalone with `node --test <file>`, no build step of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { dispatchTep } = require("../out-test/run/dispatch.js");
const { RunState } = require("../out-test/run/state.js");
const { tepSlices } = require("../out-test/dispatch/adapter.js");
const { emptySpace } = require("../out-test/core/schema.js");
const { addAsk, addNode } = require("../out-test/core/intent.js");

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl4-ac4-"));
  const g = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", dir], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "seed"]);
  return dir;
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

function writeInto(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const GREEN_PROBE =
  `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
  `import { greet } from "../src/greet.mjs";\n` +
  `test("greet", () => assert.equal(greet(), "hello"));\n`;

test("the rework brief (attempt 2+) still carries the TEP text exactly once", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-sl4-ac4" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let codeAttempts = 0;
  let reworkBrief;

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      spaceName: "greet space",
      worker: async (w, brief) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        codeAttempts++;
        if (codeAttempts === 1) {
          // Wrong on purpose so the oracle's red verdict routes a rework.
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hola"; }\n`);
        } else {
          reworkBrief = brief;
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        }
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );

  assert.equal(codeAttempts, 2, "the oracle's red verdict routed exactly one rework");
  assert.ok(reworkBrief.includes("REWORK"), "the captured brief is the rework brief");
  const headingCount = (reworkBrief.match(/^# TEP-sl4-ac4$/gm) ?? []).length;
  const asksCount = (reworkBrief.match(/## The asks \(verbatim\)/g) ?? []).length;
  assert.equal(headingCount, 1, "the rework brief carries the TEP heading exactly once");
  assert.equal(asksCount, 1, "the rework brief carries the asks section exactly once");
  assert.equal(outcome.undelivered.length, 0);
});
