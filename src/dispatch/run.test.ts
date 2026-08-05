/**
 * The run between the gates, with every boundary faked: worktree commands
 * recorded, workers injected, forge captured. Proofs come from exit codes;
 * UNDELIVERED reports survive into the delivery; a refusing anchor stops
 * the run with the premise named.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { runCut } from "./run";
import { renderProbeBrief, parseUndelivered } from "./worker";
import { emptySpace, Space } from "../core/schema";
import { addAsk, addNode } from "../core/intent";

function makeSpace(planned: boolean): Space {
  let s = emptySpace();
  const a = addAsk(s, "capture from the toolbar", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "the toolbar gains a capture box",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the box is visible" }],
    grounding: {
      touchpoints: [{ path: "src/toolbar/capture.ts", ...(planned ? { planned: true } : {}) }],
      stamp: [],
    },
  });
  assert.ok(n.ok);
  return n.space;
}

function fakes() {
  const commands: string[][] = [];
  const workerPrompts: string[] = [];
  const forgeBodies: string[] = [];
  return {
    commands,
    workerPrompts,
    forgeBodies,
    deps: {
      repoRoot: "/repo",
      model: "sonnet",
      suiteCommand: ["npm", "test"],
      forge: {
        kind: "github" as const,
        openDelivery: async (args: { body: string }) => {
          forgeBodies.push(args.body);
          return "https://forge/pull/1";
        },
        merge: async () => {},
      },
      worker: async (_d: unknown, prompt: string) => {
        workerPrompts.push(prompt);
        return { ok: true, finalText: "done" };
      },
      exec: async (cmd: string, args: string[]) => {
        commands.push([cmd, ...args]);
        return { code: 0, out: "" };
      },
    },
  };
}

test("a signed cut becomes a delivery: worktree, blind probes, builder, proofs, forge", async () => {
  const space = makeSpace(true);
  const f = fakes();
  const outcome = await runCut(f.deps as never, space, { id: "cut-1", changeIds: [space.nodes[0].id] });

  assert.ok(f.commands.some((c) => c[1] === "-C" && c[3] === "worktree" && c[4] === "add"), "worktree created");
  assert.equal(f.workerPrompts.length, 2, "probe author then builder");
  assert.ok(f.workerPrompts[0].includes("PROBE AUTHOR"), "probes first, blind");
  assert.ok(!f.workerPrompts[0].includes("COORDINATES"), "the probe author never sees the brief's coordinates");
  assert.ok(f.workerPrompts[1].includes("WORK ORDER"), "then the builder");
  assert.ok(f.workerPrompts[1].includes("probes/order-cut-1-1"), "builder must make the probes pass");

  assert.ok(outcome.delivery, "a delivery exists");
  const verdicts = outcome.delivery!.proofs.map((p) => `${p.kind}:${p.verdict}`);
  assert.ok(verdicts.includes("suite:green"));
  assert.ok(verdicts.includes("probe:green"));
  assert.equal(outcome.url, "https://forge/pull/1");
  assert.ok(f.forgeBodies[0].includes("suite: green"), "the forge body carries the proofs");
  assert.ok(f.commands.some((c) => c[0] === "git" && c.includes("push")), "the branch is pushed");
});

test("a red suite becomes a red proof — the delivery exists and cannot be accepted", async () => {
  const space = makeSpace(true);
  const f = fakes();
  f.deps.exec = async (cmd: string, args: string[]) => {
    f.commands.push([cmd, ...args]);
    return { code: cmd === "npm" ? 1 : 0, out: "1 failing" };
  };
  const outcome = await runCut(f.deps as never, space, { id: "cut-1", changeIds: [space.nodes[0].id] });
  const suite = outcome.delivery!.proofs.find((p) => p.kind === "suite")!;
  assert.equal(suite.verdict, "red");
});

test("an UNDELIVERED worker report survives into the outcome and the forge body", async () => {
  const space = makeSpace(true);
  const f = fakes();
  let call = 0;
  f.deps.worker = async (_d: unknown, prompt: string) => {
    f.workerPrompts.push(prompt);
    call++;
    return call === 2
      ? { ok: false, finalText: "UNDELIVERED: the toolbar module refused the injection — question: is the box a command instead?", undelivered: "the toolbar module refused the injection — question: is the box a command instead?" }
      : { ok: true, finalText: "done" };
  };
  const outcome = await runCut(f.deps as never, space, { id: "cut-1", changeIds: [space.nodes[0].id] });
  assert.equal(outcome.undelivered.length, 1);
  assert.ok(f.forgeBodies[0].includes("UNDELIVERED"), "gaps are on the delivery, not hidden");
});

test("an anchor that does not resolve refuses the run with the premise named", async () => {
  const space = makeSpace(false);
  const f = fakes();
  const outcome = await runCut(f.deps as never, space, { id: "cut-1", changeIds: [space.nodes[0].id] });
  assert.equal(outcome.delivery, undefined);
  assert.ok(outcome.refusals[0].includes("does not exist"));
  assert.equal(f.workerPrompts.length, 0, "no worker runs on a broken premise");
});

test("probe brief carries acceptance and contracts only; UNDELIVERED parsing", () => {
  const brief = renderProbeBrief({
    orderId: "order-1",
    contracts: ["the box — lands at src/toolbar/capture.ts"],
    acceptance: [{ nodeSentence: "the box", text: "visible" }],
    probeDir: "probes/order-1",
  });
  assert.ok(brief.includes("must not look for it"));
  assert.equal(parseUndelivered("all done"), undefined);
  assert.equal(parseUndelivered("…\nUNDELIVERED: no seam for X"), "no seam for X");
});
