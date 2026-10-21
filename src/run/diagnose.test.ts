/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The judge that runs a silent check sees, stated, what the check's
 * environment could not load though the tree holds it — and the coder is
 * not sent after it when the judge rules the check defective.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeDiagnoser } from "./diagnose";

function args(o: { output: string; reply: string | (() => never); judged: string[] }) {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "diagnose-"));
  fs.mkdirSync(path.join(tree, "frontend", "tests"), { recursive: true });
  fs.writeFileSync(path.join(tree, "frontend", "tests", "chart_AC-4.test.ts"), "expect(chart.exists()).toBe(true)\n");
  return {
    wtRoot: tree,
    worktree: tree,
    testerWt: tree,
    tep: "TEP-x-2",
    sliceProbes: new Map([["SL-1", ["frontend/tests/chart_AC-4.test.ts"]]]),
    sliceVerifs: new Map([["SL-1", [{ ac: 4, run: "frontend/run_tests.sh frontend/tests/chart_AC-4.test.ts" }]]]),
    criterionOf: () => ({ id: "c-4", text: "each frame is drawn with the dental chart" }),
    model: "sonnet",
    boundedExec: async () => ({ code: 1, output: o.output }),
    exec: async () => ({ code: 0, out: "backend/app/modules/odontogram/frontend/components/odontogram/OdontogramChart.vue\n" }),
    supervisorRound: async (_r: unknown, prompt: string) => {
      o.judged.push(prompt);
      if (typeof o.reply === "function") o.reply();
      return o.reply as string;
    },
    log: () => {},
    defect: () => {},
  };
}

test("an environment that cannot load a component the tree holds is stated to the judge, and its DEFECTIVE ruling re-authors the check", async () => {
  const judged: string[] = [];
  const reauthored: string[] = [];
  const diagnose = makeDiagnoser(
    args({
      output: "[Vue warn]: Failed to resolve component: OdontogramChart\nAssertionError: expected false to be true",
      reply: "DEFECTIVE: the test environment does not load the odontogram layer, so OdontogramChart never resolves",
      judged,
    }) as never,
    async (_slice, _ac, why) => {
      reauthored.push(why);
      return true;
    },
  );
  const ruled = await diagnose("SL-1", 4, "AssertionError: expected false to be true");
  assert.ok(ruled?.reauthored);
  assert.match(judged[0], /THE TEST ENVIRONMENT COULD NOT LOAD THESE, THOUGH THE TREE HOLDS THEM/);
  assert.match(judged[0], /the component OdontogramChart — provided by backend\/app\/modules\/odontogram\/.*OdontogramChart\.vue/);
  assert.match(reauthored[0], /does not load the odontogram layer/);
});

test("a judge that cannot be reached gives no ruling and says so", async () => {
  const lines: string[] = [];
  const a = args({
    output: "AssertionError: expected false to be true",
    reply: () => {
      throw new Error("the model round ended without an answer");
    },
    judged: [],
  });
  const diagnose = makeDiagnoser({ ...a, log: (l: string) => lines.push(l) } as never, async () => true);
  assert.equal(await diagnose("SL-1", 4, "AssertionError: expected false to be true"), undefined);
  assert.ok(lines.some((l) => /the judge could not rule on check 4 — the model round ended without an answer/.test(l)), lines.join("\n"));
});
