/**
 * A signed TEP runs through the engine: tests-first, blinded tester,
 * oracle-confirmed green, honest proofs. This file exercises the
 * dispatcher's own brief-building — not the whole delivery — through an
 * injected worker fake that records exactly what each role's brief holds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { renderTepBody } from "./briefs";
import { SHAPES, repoInShape } from "./shapes";
import type { RepoShape } from "./shapes";
import type { WorkerOutcome } from "./worker";

/** One ask, one code-role landing plus its held-out test unit — enough
 *  for the run to dispatch both a coder brief and a tester brief. */
function oneAsk(): { space: ReturnType<typeof emptySpace>; ids: string[] } {
  let s = emptySpace();
  const a = addAsk(s, "greet the user", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, ids: [n.added.id] };
}

const shape: RepoShape = SHAPES[0];

// INVARIANT: the run dispatcher passes the rendered TEP body to
// buildWorkerPrompt exactly once, as the intent — never doubled under
// both the specBody and tepBody fields. Observed through an injected
// worker fake that records each unit's brief text, for both roles.
test("a dispatched run's coder and tester briefs each carry the rendered TEP body exactly once", async () => {
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-dispatch-once" };
  const tepBody = renderTepBody(space, cut);
  assert.ok(tepBody.trim(), "the rendered TEP body is non-empty for this fixture");

  const briefs: { role: string; footprint: string[]; brief: string }[] = [];
  const worker = async (
    deps: { role: "code" | "test"; worktree: string; footprint: string[] },
    brief: string,
  ): Promise<WorkerOutcome> => {
    briefs.push({ role: deps.role, footprint: deps.footprint, brief });
    if (/You are the CLOSER/.test(brief))
      return { ok: true, finalText: "UNDELIVERED: none" };
    if (deps.role === "test") {
      for (const rel of deps.footprint) {
        const dest = path.join(deps.worktree, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(
          dest,
          `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
            `import { greet } from "../src/greet.mjs";\ntest("greet", () => assert.equal(greet(), "hello"));\n`,
        );
      }
      return { ok: true, finalText: "done" };
    }
    fs.writeFileSync(
      path.join(deps.worktree, "src/greet.mjs"),
      `export function greet() { return "hello"; }\n`,
    );
    return { ok: true, finalText: "done" };
  };

  const state = new RunState(() => {});
  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "dispatch-once",
      worker,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "dispatch-once" }),
  );

  const coderBriefs = briefs.filter((b) => b.role === "code" && !/You are the CLOSER/.test(b.brief));
  const testerBriefs = briefs.filter((b) => b.role === "test");
  assert.ok(coderBriefs.length > 0, "at least one coder brief was dispatched");
  assert.ok(testerBriefs.length > 0, "at least one tester brief was dispatched");

  for (const b of coderBriefs)
    assert.equal(
      b.brief.split(tepBody).length - 1,
      1,
      "the coder's brief carries the rendered TEP body exactly once",
    );
  for (const b of testerBriefs)
    assert.equal(
      b.brief.split(tepBody).length - 1,
      1,
      "the tester's brief carries the rendered TEP body exactly once",
    );
});
