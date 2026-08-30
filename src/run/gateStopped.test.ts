/**
 * A stopped run is not graded.
 *
 * The closing gate is where a run spends its longest hour: every check
 * run against the delivered tree, every assessment reviewed by a fresh
 * reader, then the finisher and the closer. At the very end it asked
 * whether the run was still alive, and if it was not it threw the whole
 * verdict away — "nothing was judged from a stopped run", whatever the
 * grading had found.
 *
 * So a run halted at its bound spent fifty-five more minutes producing an
 * answer that was discarded by design, and the person waiting saw a run
 * that would not end. The question costs nothing; it is asked first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeGate } from "./gate";
import { RunState } from "./state";
import { emptySpace } from "../core/schema";
import { proved } from "./proved";

test("a run stopped before the gate grades nothing and says so", async () => {
  const st = new RunState(() => {});
  st.halt();
  const ran: string[] = [];

  const out = await closeGate({
    tep: "TEP-1",
    branch: "tandem/TEP-1",
    baseSha: "abc",
    worktree: "/nowhere",
    slices: [],
    space: emptySpace(),
    cut: { id: "cut-1", tepId: "TEP-1", changeIds: [] },
    deps: { repoRoot: "/nowhere", state: st },
    runOne: proved("npm test -- <file>", true)!,
    sliceProbes: new Map(),
    sliceCommitted: new Set(),
    checkOf: new Map(),
    undelivered: ["SL-1#eu-0: the run stopped before this unit finished"],
    rulings: [],
    decisions: [],
    exec: async (cmd: string, args: string[]) => (ran.push(`${cmd} ${args[0]}`), { code: 0, out: "" }),
    boundedExec: async (cmd: string) => (ran.push(cmd), { code: 0, output: "" }),
    suiteExec: async (cmd: string) => (ran.push(cmd), { code: 0, output: "" }),
    state: st,
    sessionOf: () => undefined,
    worker: async () => (ran.push("a worker round"), { ok: true, finalText: "" }),
    machineAttention: () => 0,
    log: () => {},
    defect: () => {},
  } as never);

  assert.deepEqual(ran, [], "nothing is run for a verdict that will be thrown away");
  assert.match(
    out.delivery?.withheld ?? "",
    /stopped before its promises were graded/,
    "and the report says the run was stopped, not that the work failed",
  );
  assert.deepEqual(
    out.delivery?.undelivered,
    ["SL-1#eu-0: the run stopped before this unit finished"],
    "what the units already reported still reaches the person",
  );
});
