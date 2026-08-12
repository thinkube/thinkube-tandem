// WHY (INVARIANT): a cut whose documentation is validly waived must finish
// with NO docs-obligation line on the delivery, regardless of what its
// slices happen to touch (docs/ path or not).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { dispatchTep } from "../out/run/dispatch.js";
import { RunState } from "../out/run/state.js";
import { tepSlices } from "../out/dispatch/adapter.js";
import { emptySpace } from "../out/core/schema.js";
import { addAsk, addNode } from "../out/core/intent.js";

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-run-"));
  const g = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", dir], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "seed"]);
  return dir;
}

function writeInto(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

test("a run of a waived cut finishes with no docs obligation line, whatever its slices touch", async () => {
  const repo = tmpRepo();
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
  const cut = {
    id: "cut-1",
    changeIds: [n.added.id],
    tepId: "TEP-t-ac5",
    docs: { waived: true, reason: "internal refactor, nothing user-facing" },
  };
  const slices = tepSlices({ space: n.space, cut, spaceName: "ac5 space" });
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      spaceName: "ac5 space",
      worker: async (w) => {
        if (w.role === "test")
          writeInto(
            w.worktree,
            w.footprint[0],
            `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { greet } from "../src/greet.mjs";\ntest("greet", () => assert.equal(greet(), "hello"));\n`,
          );
        else writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    n.space,
    cut,
    slices,
  );
  assert.ok(
    !outcome.undelivered.some((u) => u.includes("docs obligation unmet")),
    "a waived cut never owes a docs-obligation line, even with no docs/ touchpoint",
  );
});
