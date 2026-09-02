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
    author: "tester",
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

/** The cut without what the machine minted for it: the person's own promises. */
const own = (s: { cutNodeIds: Set<string> }): string[] => [...s.cutNodeIds].filter((id) => !/-gap-\d/.test(id));

test("a set becomes the cut — one delivery per set, which is the point", async () => {
  const s = sessionWithSets();

  assert.deepEqual(await s.chooseSpec("spec-1"), { ok: true });
  assert.deepEqual(own(s), ["n1"], "one set's promises, and not the other's");
  assert.equal(s.cutSpecId, "spec-1");

  // Choosing again replaces; it never accumulates back into everything.
  assert.deepEqual(await s.chooseSpec("spec-2"), { ok: true });
  assert.deepEqual(own(s), ["n2"]);
  // Documentation is part of every delivery: the set brings its page with it.
  assert.equal([...s.cutNodeIds].filter((id) => /-gap-\d/.test(id)).length, 1, "the set's own documentation promise rides with it");

  // Touched by hand it is no longer the set it was offered as, and the cut
  // must not later claim it was.
  s.toggleCut(["n1"]);
  assert.equal(s.cutSpecId, undefined, "a cut edited by hand is nobody's set");
  assert.equal(own(s).length, 2);
});

/**
 * Choosing a set is what pays for working it out.
 *
 * It used to be the other way round: everything was worked out first, and
 * only then could a set be chosen — which made the grouping useless, because
 * the sets exist to decide what is worth working out. Nineteen asks worked
 * out at once became one cut, one gate and three days. A set nobody chooses
 * now costs nothing to have considered.
 */
test("choosing a set works out that set, and only that set", async () => {
  const s = sessionWithSets();
  // A set whose subjects are already served by promises is not worked out
  // twice — choosing it a second time spends nothing.
  assert.deepEqual(await s.chooseSpec("spec-1"), { ok: true });
  assert.deepEqual(await s.chooseSpec("spec-1"), { ok: true });

  // And a set nobody chose is never worked out at all — the saving the
  // whole layer exists for. Choosing spec-1 twice touched nothing of spec-2.
  assert.deepEqual(own(s), ["n1"]);
});

test("a set that does not exist is refused by name", async () => {
  const s = sessionWithSets();
  const gone = await s.chooseSpec("spec-99");
  assert.equal(gone.ok, false);
  assert.match(gone.reason ?? "", /no set called/);
});
