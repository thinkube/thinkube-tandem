/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The footprint is enforced before a write, as rules the harness reads,
 * and the door grants a rule rather than restoring a file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedFor, doorFor, footprintRules, toolsGivenTo } from "./footprintRules";

const WT = "/wt/tandem__TEP-31";

test("a footprint entry is a rule for the path and for everything under it", () => {
  assert.deepEqual(footprintRules(["src/a.ts", "./src/b/", ""]), [
    "Edit(src/a.ts)",
    "Edit(src/a.ts/**)",
    "Edit(src/b)",
    "Edit(src/b/**)",
  ]);
});

test("a question asked through the tool goes to the run, and the answer comes back as the tool's result", async () => {
  const heard: string[] = [];
  const door = doorFor({
    worktree: WT,
    footprint: () => [],
    granted: () => undefined,
    ask: async (q) => (heard.push(q), "accounts"),
    log: () => undefined,
  });
  const input = { questions: [{ question: "Which table?", options: [{ label: "users" }, { label: "accounts" }] }] };
  const a = await door("AskUserQuestion", input);
  assert.deepEqual(heard, ["Which table? (users / accounts)"]);
  assert.equal(a.behavior, "allow");
  if (a.behavior === "allow" && "updatedInput" in a) assert.deepEqual(a.updatedInput.answers, { "Which table?": "accounts" });
  else assert.fail("the answer rides the tool's input");
  const nobody = doorFor({ worktree: WT, footprint: () => [], granted: () => undefined, log: () => undefined });
  assert.equal((await nobody("AskUserQuestion", input)).behavior, "deny", "with nobody to ask, the question is refused");
});

test("a worker's tools are an allow list; only the closer gets the whole set", () => {
  assert.deepEqual(toolsGivenTo({ role: "code" }), ["Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit", "Bash", "AskUserQuestion"]);
  assert.ok(!(toolsGivenTo({ role: "test" }) as string[]).includes("Bash"), "a tester has no shell");
  assert.ok(!(toolsGivenTo({ role: "code", blind: true }) as string[]).includes("Bash"), "nor a blinded coder");
  assert.deepEqual(toolsGivenTo({ unfenced: true }), { type: "preset", preset: "claude_code" });
});

test("what runs without the door: looking, Tandem's tools, the footprint, and a shell where the role has one", () => {
  const coder = allowedFor({ role: "code", footprint: ["src/a.ts"] });
  assert.ok(coder.includes("Bash"));
  assert.ok(coder.includes("mcp__tandem__verify"));
  assert.ok(coder.includes("Edit(src/a.ts)"));
  assert.ok(!allowedFor({ role: "test", footprint: [] }).includes("Bash"));
});

test("the door grants a session rule and widens the footprint, so the write goes ahead and is not asked again", async () => {
  let footprint = ["src/a.ts"];
  const asked: string[][] = [];
  const door = doorFor({
    worktree: WT,
    footprint: () => footprint,
    clearFor: async (paths) => {
      asked.push(paths);
      return { granted: paths, refused: [] };
    },
    granted: (p) => (footprint = [...footprint, ...p]),
    log: () => undefined,
  });
  const answer = await door("Edit", { file_path: `${WT}/src/b.ts` });
  assert.deepEqual(asked, [["src/b.ts"]], "asked as the repository sees the path");
  assert.equal(answer.behavior, "allow");
  if (answer.behavior === "allow" && "updatedPermissions" in answer) {
    assert.equal(answer.updatedPermissions[0].destination, "session");
    assert.deepEqual(
      answer.updatedPermissions[0].rules.map((r) => r.ruleContent),
      ["src/b.ts", "src/b.ts/**"],
    );
  }
  assert.deepEqual(footprint, ["src/a.ts", "src/b.ts"]);
});

test("a refusal names the path, the reason, and what may be written; nothing is undone because nothing was written", async () => {
  const door = doorFor({
    worktree: WT,
    footprint: () => ["src/a.ts"],
    clearFor: async (paths) => ({ granted: [], refused: paths.map((p) => ({ path: p, why: "another unit owns it" })) }),
    granted: () => assert.fail("nothing was granted"),
    log: () => undefined,
  });
  const answer = await door("Write", { file_path: `${WT}/src/c.ts` });
  assert.equal(answer.behavior, "deny");
  if (answer.behavior === "deny") {
    assert.match(answer.message, /src\/c\.ts is not yours to change, so nothing was written/);
    assert.match(answer.message, /another unit owns it/);
    assert.match(answer.message, /What you may write is: src\/a\.ts/);
  }
});

test("without a run to ask, and for a tool that is not a file tool, the door refuses", async () => {
  const door = doorFor({ worktree: WT, footprint: () => ["src/a.ts"], granted: () => undefined, log: () => undefined });
  assert.equal((await door("Edit", { file_path: `${WT}/src/z.ts` })).behavior, "deny");
  const other = await door("WebFetch", { url: "https://example.com" });
  assert.equal(other.behavior, "deny");
  if (other.behavior === "deny") assert.match(other.message, /WebFetch is not among the tools/);
});
