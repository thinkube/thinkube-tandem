// AC-7 (INVARIANT): the same marker count pinned in AC-6 must also hold on
// the REWORK brief (attempt 2+), since a rework brief is built by appending
// to the base brief rather than re-rendering it — a regression that
// restores double-threading would show up there too. Reverting the
// dispatch.ts fix (passing the TEP body into both the specBody and tepBody
// slots again) makes this assertion fail with a count of 2, which is the
// behaviour this test exists to catch, forever.
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

const MARKER = "## The asks (verbatim)";

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl4-ac7-"));
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

function countMarker(text) {
  return (text.match(new RegExp(MARKER.replace(/[()]/g, "\\$&"), "g")) ?? []).length;
}

const GREEN_PROBE =
  `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
  `import { greet } from "../src/greet.mjs";\n` +
  `test("greet", () => assert.equal(greet(), "hello"));\n`;

test("the marker count stays exactly 1 on the captured rework brief too", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-sl4-ac7" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let codeAttempts = 0;
  let reworkBrief;

  await dispatchTep(
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

  assert.equal(codeAttempts, 2, "a rework round happened");
  assert.ok(reworkBrief.includes("REWORK"), "the captured brief is the rework brief");
  assert.equal(countMarker(reworkBrief), 1, "the rework brief's marker count is exactly 1, not 2");
});
