// AC-3 (TRANSITION): proves the TEP text rides under the "THE INTENT —
// the north star" marker, and that no "PARENT SPEC" block appears at all in
// a tandem-dispatched brief — the spec slot is emptied so the TEP is not
// echoed there under a different heading. Its job is done once dispatch.ts
// stops passing the rendered TEP body into buildWorkerPrompt's specBody
// slot.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl4-ac3-"));
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

test("the TEP text rides under THE INTENT marker and no PARENT SPEC block appears in a tandem-dispatched brief", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-sl4-ac3" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const briefs = [];

  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      spaceName: "greet space",
      worker: async (w, brief) => {
        briefs.push({ role: w.role, text: brief });
        if (w.role === "test") writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
        else writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );

  assert.ok(briefs.length >= 2, "both the test and code units dispatched");
  for (const b of briefs) {
    assert.ok(
      b.text.includes("──── THE INTENT — the north star"),
      `${b.role} brief carries the TEP under the north-star marker`,
    );
    assert.ok(
      !b.text.includes("──── PARENT SPEC"),
      `${b.role} brief must not carry a PARENT SPEC block`,
    );
  }
});
