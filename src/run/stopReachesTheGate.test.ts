/**
 * Stop reaches the closing gate's reviews. Sixty reviews are asked five at
 * a time; a run stopped during them used to grade every one before the
 * gate noticed, and a person who pressed Stop waited on a verdict nobody
 * could use.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeAssessments } from "./assess";
import { emptySpace, Space } from "../core/schema";

function spaceWith(reviews: number): { space: Space; cut: Space["cuts"][number] } {
  const nodes = Array.from({ length: reviews }, (_, i) => ({
    id: `n${i}`,
    sentence: `promise ${i}`,
    serves: ["a1"],
    needs: [],
    acceptance: [{ id: `n${i}-check-1`, text: `a reviewer confirms promise ${i} holds`, kind: "assessment" }],
  }));
  const space = { ...emptySpace(), asks: [{ id: "a1", text: "one", at: "" }], nodes } as unknown as Space;
  const cut = { id: "cut-1", changeIds: nodes.map((n) => n.id) } as Space["cuts"][number];
  return { space, cut };
}

test("no review is asked after Stop, and the ones in flight are aborted", async () => {
  const { space, cut } = spaceWith(12);
  let asked = 0;
  let halted = false;
  const registered: AbortController[] = [];
  const round = async (): Promise<string> => {
    asked++;
    if (asked === 3) halted = true;
    await new Promise((r) => setTimeout(r, 5));
    return "GREEN";
  };
  await gradeAssessments({
    space,
    cut,
    testerWt: "/wt",
    model: "sonnet",
    round: round as never,
    halted: () => halted,
    abortable: (ab: AbortController) => registered.push(ab),
  } as never);
  assert.ok(asked < 12, `every review was still asked after Stop: ${asked}`);
  assert.ok(registered.length >= asked, "each review registered a controller Stop can abort");
});
