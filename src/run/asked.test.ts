/**
 * Which questions reach the person, and which the machine answers itself.
 *
 * A person is asked about the WORK — a choice their own asks do not settle
 * — and never about the machine: not a file, not a path, not a tool, not
 * an error code. The test used to match TypeScript, so a Python worker
 * asking about `handlers.py` or a Go worker about `go.mod` named an
 * internal and was not caught, and the question reached the person as if
 * it were about what they had asked for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { reachesThePerson } from "./answers";
import { makeChallenge } from "./challenge";

/**
 * A question that names the machine is answered by the machine, whatever
 * language the work is in.
 *
 * The test used to match TypeScript — `.ts`, `.json`, `tsc`, `npm` — so a
 * Python worker asking about `handlers.py`, or a Go worker about
 * `go.mod`, named an internal and was not caught: the question reached the
 * person as if it were about the work they asked for.
 */
test("a question naming a file is machinery, in any language", () => {
  for (const q of [
    "should handlers.py return 404 or 422 here?",
    "does go.mod need the new module path?",
    "is lib/parser.rb the right place?",
    "which of src/run/gate.ts owns this?",
  ])
    assert.equal(reachesThePerson(q), false, `${q} names the machine`);
});

test("a question about the work reaches the person", () => {
  for (const q of [
    "when someone presses stop mid-way, should the work already done be kept or discarded?",
    "should a delivery with a red review still be offered, or held back?",
  ])
    assert.equal(reachesThePerson(q), true, `${q} is about the work`);
});

/**
 * A criterion that cannot be met is asked about, not ground against.
 *
 * The oracle may rule a check DEFECTIVE when no correct implementation
 * could pass it — but the only remedy it had was to rewrite the probe FROM
 * THE CRITERION, told not to weaken it. When the impossibility is in the
 * criterion (six states, each with its own tone, out of a five-value type),
 * every faithful rewrite makes the same impossible demand, so the coder
 * verified and rewrote until its budget ran out and the promise was
 * reported unkept — for something no worker could ever have delivered.
 * Nothing in the run may change what was asked for except the person who
 * asked, so the question goes to them.
 */
test("an impossible criterion stops the unit at a question for its author", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-impossible-"));
  const rel = "checks/tones_AC-4.test.ts";
  fs.mkdirSync(path.join(dir, "checks"), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), "// asserts six distinct tones\n");

  const asked: { unit: string; question: string }[] = [];
  let reauthoredFrom = "";
  const challenge = makeChallenge({
    testerWt: dir,
    model: "sonnet",
    sliceProbes: new Map([["SL-1", [rel]]]),
    briefBySlice: new Map(),
    criterionOf: () => ({ id: "c4", text: "each of the six unit states gets its own tone" }),
    acting: () => ({ unit: "SL-1#eu-0" }),
    log: () => {},
    defect: () => {},
    supervisorRound: async () =>
      "IMPOSSIBLE: six states cannot have pairwise-distinct tones from a five-value union",
    askPerson: async (unit: string, question: string) => {
      asked.push({ unit, question });
      return "just the four states I named: running, needs you, passed, failed";
    },
    author: async (_o: unknown, prompt: string) => {
      reauthoredFrom = prompt;
      fs.writeFileSync(path.join(dir, rel), "// asserts four distinct tones\n");
      return "done";
    },
  } as never)("SL-1");

  const said = await challenge(4, "no implementation can pass this");

  assert.equal(asked.length, 1, "the person who signed the criterion is the one asked");
  assert.match(asked[0].question, /each of the six unit states gets its own tone/, "their own words");
  assert.equal(reachesThePerson(asked[0].question), true, "asked about the work, not the machine");
  assert.match(reauthoredFrom, /AS AMENDED BY THE PERSON/, "their answer is the new spec");
  assert.match(reauthoredFrom, /four states/);
  assert.match(said, /^AMENDED/, "and the coder is told to verify again, not to keep trying");
});

test("with nobody to ask, the coder is told to stop rather than grind", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-impossible-"));
  const rel = "checks/tones_AC-4.test.ts";
  fs.mkdirSync(path.join(dir, "checks"), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), "// asserts six distinct tones\n");
  let reauthored = false;

  const said = await makeChallenge({
    testerWt: dir,
    model: "sonnet",
    sliceProbes: new Map([["SL-1", [rel]]]),
    briefBySlice: new Map(),
    criterionOf: () => ({ id: "c4", text: "each of the six unit states gets its own tone" }),
    acting: () => ({ unit: "SL-1#eu-0" }),
    log: () => {},
    defect: () => {},
    supervisorRound: async () => "IMPOSSIBLE: more distinct values than the type holds",
    author: async () => ((reauthored = true), "done"),
  } as never)("SL-1")(4, "no implementation can pass this");

  assert.equal(reauthored, false, "rewriting the probe reproduces the same demand");
  assert.match(said, /UNDELIVERED/, "the way out is to report it, not to try again");
});
