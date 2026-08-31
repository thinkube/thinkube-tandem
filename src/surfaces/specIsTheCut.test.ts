/**
 * Choosing a set puts that set's promises in the cut, and nothing else.
 *
 * This is the whole point of the layer, and it needed almost no machinery:
 * dispatch, the gate and the delivery are already per-cut. What was missing
 * was anything that ever put FEWER THAN EVERYTHING into one. Nineteen asks
 * went in together and came back three days later as a single delivery
 * nobody could correct a part of.
 *
 * A set is an offer, not a gate: the cut can still be built promise by
 * promise, and touching it by hand means it is no longer the set it was
 * offered as — which the delivery must not then claim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { emptySpace } from "../core/schema";

function sessionWithSets(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-spec-cut-"));
  const s = new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  } as never);
  s.space = {
    ...emptySpace(),
    asks: [
      { id: "a1", text: "the tab row should stay put" },
      { id: "a2", text: "cards should say what they keep" },
    ],
    subjects: [
      { id: "s1", name: "the tab row", from: ["a1"] },
      { id: "s2", name: "every card in a run", from: ["a2"] },
    ],
    nodes: [
      { id: "n1", serves: ["a1"], sentence: "the row holds still", needs: [], acceptance: [] },
      { id: "n2", serves: ["a2"], sentence: "a card names its promise", needs: [], acceptance: [] },
    ],
    specs: [
      { id: "spec-1", name: "the layout is stable", subjectIds: ["s1"] },
      { id: "spec-2", name: "I can read the run graph", subjectIds: ["s2"] },
    ],
  } as never;
  return s;
}

test("a set becomes the cut — one delivery per set, which is the point", () => {
  const s = sessionWithSets();

  assert.deepEqual(s.chooseSpec("spec-1"), { ok: true });
  assert.deepEqual([...s.cutNodeIds], ["n1"], "one set's promises, and not the other's");
  assert.equal(s.cutSpecId, "spec-1");

  // Choosing again replaces; it never accumulates back into everything.
  assert.deepEqual(s.chooseSpec("spec-2"), { ok: true });
  assert.deepEqual([...s.cutNodeIds], ["n2"]);

  // Touched by hand it is no longer the set it was offered as, and the cut
  // must not later claim it was.
  s.toggleCut(["n1"]);
  assert.equal(s.cutSpecId, undefined, "a cut edited by hand is nobody's set");
  assert.equal(s.cutNodeIds.size, 2);
});

test("a set with nothing derived from it yet is refused, in words", () => {
  const s = sessionWithSets();
  s.space = { ...s.space, nodes: [] } as never;
  const r = s.chooseSpec("spec-1");
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /nothing is derived from "the layout is stable" yet/);

  const gone = s.chooseSpec("spec-99");
  assert.equal(gone.ok, false);
  assert.match(gone.reason ?? "", /no set called/);
});
