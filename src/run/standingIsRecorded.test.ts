/**
 * Whether a slice finished is read from the record, never guessed.
 *
 * A commit says a slice ran AND changed something. Its absence says nothing
 * at all. A slice that found its work already done committed nothing, was
 * taken for one that had never run, and started again on every resume — did
 * nothing, committed nothing, and earned the same reading next time. One
 * tests slice did that on three consecutive runs of the same cut.
 *
 * The run already knew: its record carries every unit and the state it
 * reached. The fact is read back, not re-derived from the tree — a guess
 * about a thing the machine wrote down is a worse answer than the note.
 *
 * There is one record per cut, and a resume overwrites it as it goes, so
 * the read happens at the run's start. And the run's arguments are
 * assembled field by field down four hops: a field nobody copies at one of
 * them never arrives, however faithfully it was set upstream.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { slicesFinished } from "./record";
import { standingSlices } from "./plan";

const CUT = "cut-1";

function storeWith(units: { id: string; slice: string; state: string }[]): string {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-standing-"));
  fs.mkdirSync(path.join(store, "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(store, "runs", `${CUT}.json`),
    JSON.stringify({ cutId: CUT, at: "2026-08-31T10:00:00Z", state: "withheld", units }),
  );
  return store;
}

test("a slice whose every unit finished is recorded as finished", () => {
  const store = storeWith([
    { id: "SL-4-tests#eu-0", slice: "SL-4-tests", state: "done" },
    { id: "SL-9#eu-0", slice: "SL-9", state: "done" },
    { id: "SL-9#eu-1", slice: "SL-9", state: "done" },
  ]);
  assert.deepEqual(slicesFinished(store, CUT).sort(), ["SL-4-tests", "SL-9"]);
});

test("a slice with a unit that did not finish is not", () => {
  const store = storeWith([
    { id: "SL-9#eu-0", slice: "SL-9", state: "done" },
    { id: "SL-9#eu-1", slice: "SL-9", state: "failed" },
  ]);
  assert.deepEqual(slicesFinished(store, CUT), [], "one unfinished unit and the slice runs again");
});

test("no record at all falls back to the commits, rather than failing", () => {
  assert.deepEqual(slicesFinished(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-none-")), CUT), []);
});

const DAG = [{ slice: "SL-4-tests", footprint: ["src/x_AC-1.test.ts"] }];

test("a slice that committed nothing still stands when the run recorded finishing it", async () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-"));
  fs.mkdirSync(path.join(wt, "src"), { recursive: true });
  fs.writeFileSync(path.join(wt, "src", "x_AC-1.test.ts"), "// the check it owed");

  const said: string[] = [];
  const standing = await standingSlices([], DAG, wt, (l) => said.push(l), ["SL-4-tests"]);

  assert.ok(standing.has("SL-4-tests"), "having nothing left to change is not the same as never running");
  assert.match(said.join("\n"), /committed nothing, and an earlier run recorded finishing it/);
});

test("a plan that has grown since still re-runs the slice, recorded or not", async () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-grown-"));
  const standing = await standingSlices([], DAG, wt, () => {}, ["SL-4-tests"]);
  assert.equal(standing.has("SL-4-tests"), false, "the check this plan asks for is not written — the record cannot excuse that");
});

test("nothing recorded leaves the old behaviour exactly as it was", async () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-plain-"));
  fs.mkdirSync(path.join(wt, "src"), { recursive: true });
  fs.writeFileSync(path.join(wt, "src", "x_AC-1.test.ts"), "// written");
  assert.ok((await standingSlices(["SL-4-tests"], DAG, wt, () => {})).has("SL-4-tests"));
  assert.equal((await standingSlices([], DAG, wt, () => {})).size, 0);
});

/**
 * The run's arguments are built field by field at each hop. A `freshStart`
 * set faithfully upstream once reached nothing because one hop did not copy
 * it, and the run silently resumed instead of starting over. This reads
 * every hop rather than trusting the type, which cannot see an omission.
 */
test("the recorded fact reaches the run through every hop", () => {
  const at = (rel: string): string => fs.readFileSync(path.resolve(__dirname, "..", "..", "src", rel), "utf8");
  const missing = [
    ["surfaces/runGate.ts", /slicesFinished\(s\.deps\.storeDir, cutId\)/, "read at the run's start, before its own record overwrites the last one"],
    ["surfaces/runGate.ts", /finishedBefore \}/, "handed to the dispatch it starts"],
    ["dispatch/scopeRun.ts", /finishedBefore: args\.finishedBefore/, "copied into the deps the door is built from"],
    ["run/dispatch.ts", /deps\.finishedBefore/, "and read where standing is decided"],
  ]
    .filter(([file, re]) => !(re as RegExp).test(at(file as string)))
    .map(([file, , why]) => `${file as string} — ${why as string}`);

  assert.deepEqual(missing, [], "a hop that does not copy it drops the fact silently");
});
