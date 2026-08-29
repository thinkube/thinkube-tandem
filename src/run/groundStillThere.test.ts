/**
 * A cut is written against the code as it was. Between the writing and the
 * run — or in the middle of the run, arriving with a base merge — somebody
 * commits an urgent fix with no ask behind it, and the file a promise names
 * is moved, renamed or deleted.
 *
 * Nothing noticed. The run merged the new commits, repaired the conflict,
 * and kept dispatching workers against facts that were gone: the tester
 * wrote checks for a symbol nobody has, every check went red, and the
 * promises came back unkept with no worker able to act on the reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { emptySpace } from "../core/schema";
import { groundThatMoved, regroundingNeeded } from "./groundStillThere";

function spaceWith(touchpoints: { path: string; planned?: boolean }[]) {
  return {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "the card's header band is brilliant green",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the band is green" }],
        grounding: { touchpoints, stamp: [] },
      },
    ],
  };
}

test("a promise grounded on code that is gone stops the run, naming what moved", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "ground-"));
  fs.mkdirSync(path.join(tree, "src"), { recursive: true });

  const moved = await groundThatMoved({
    worktree: tree,
    space: spaceWith([{ path: "src/card.ts" }]) as never,
    cut: { id: "cut-1", changeIds: ["n1"] } as never,
  });

  assert.equal(moved.length, 1);
  assert.deepEqual(moved[0].missing, ["src/card.ts"]);
  const said = regroundingNeeded(moved);
  assert.match(said, /the card's header band is brilliant green/, "the person's own words");
  assert.match(said, /no ask behind it/, "and why it happened");
  assert.match(said, /Ground them again/, "and the one thing that settles it");
});

test("a file this cut will create is not missing — it is planned", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "ground2-"));
  const moved = await groundThatMoved({
    worktree: tree,
    space: spaceWith([{ path: "src/newThing.ts", planned: true }]) as never,
    cut: { id: "cut-1", changeIds: ["n1"] } as never,
  });
  assert.deepEqual(moved, [], "absence before the work starts is the normal state");
});

test("a promise the cut does not carry is nobody's business here", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "ground3-"));
  const moved = await groundThatMoved({
    worktree: tree,
    space: spaceWith([{ path: "src/card.ts" }]) as never,
    cut: { id: "cut-1", changeIds: ["someone-else"] } as never,
  });
  assert.deepEqual(moved, []);
});
