/**
 * The delivery page reads for someone who was not here.
 *
 * A proof's `ref` is the MACHINE's face of the evidence — the command, its
 * exit code, the tail of its output. That is what a record should hold, and
 * it was also what the page printed as the explanation. Of a hundred and
 * eighty-nine proofs carrying evidence, a hundred and thirty-eight showed
 * the reader a shell line with a `sed` expression inside it.
 *
 * The person deciding at Accept did not build this and cannot be asked to
 * read a runner invocation. A kept promise needs no evidence beside it: the
 * criterion and its mark say everything. One that failed needs the sentence
 * the check itself wrote. One nobody could judge says so in those words —
 * and is not marked as a failure, because nothing failed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "./render";

const SPACE = {
  asks: [{ id: "ask-1", text: "the pages behave" }],
  nodes: [{ id: "n-1", serves: ["ask-1"], sentence: "the surface behaves", acceptance: [] }],
  cuts: [{ id: "cut-1", changeIds: ["n-1"] }],
} as never;

const page = (proofs: unknown[]): string =>
  renderDeliveryPage(SPACE, { id: "d-1", cutId: "cut-1", branch: "tandem/x", proofs } as never);

const RUNNER = "src/surfaces/pages_AC-1.test.ts";
const COMMAND = `$ node --test "$(echo ${RUNNER} | sed 's#^src/#out-test/#; s#\\.ts$#.js#')" → exit 1`;

test("a kept promise stands on its criterion, with no machine face beside it", () => {
  const p = page([{ kind: "probe", label: "every handle appears in the source", verdict: "green", ref: `${COMMAND.replace("exit 1", "exit 0")}\nok 1 - every handle appears` }]);
  assert.match(p, /- ✓ every handle appears in the source/);
  assert.doesNotMatch(p, /\$ node --test/, "a passing check does not need its command read aloud");
  assert.doesNotMatch(p, /sed |out-test\//);
});

test("a broken promise shows what the check said, not what the machine typed", () => {
  const p = page([{
    kind: "probe",
    label: "every handle appears in the source",
    verdict: "red",
    ref: `${COMMAND}\nnot ok 1 - data-delivery-report is missing from App.tsx\n  duration_ms: 12`,
  }]);
  assert.match(p, /data-delivery-report is missing from App\.tsx/, "the check's own sentence is the explanation");
  assert.doesNotMatch(p, /not ok 1 -/, "and its runner's bookkeeping is not");
  assert.doesNotMatch(p, /\$ node --test|sed |exit 1/);
});

test("a failure with nothing to quote still says something, rather than nothing", () => {
  const p = page([{ kind: "probe", label: "the module exports one handle", verdict: "red", ref: COMMAND }]);
  const line = p.split("\n").find((l) => l.startsWith("- ✗ the module exports one handle")) ?? "";
  assert.match(line, /did not pass/, "a failure with no reason beside it tells the reader nothing");
  assert.match(line, /run record/, "and it says where the command and output were kept");
});

test("a check nobody could run is not shown as a broken promise", () => {
  const p = page([{ kind: "probe", label: "the module exports one handle", verdict: "unjudged", ref: COMMAND }]);
  assert.doesNotMatch(p, /- ✗ the module exports one handle/, "nothing failed, so nothing is marked failed");
  assert.match(p, /- ○ the module exports one handle — the machine could not run this check/);
});

test("a promise settled after the merge says where its answer comes from", () => {
  const p = page([{ kind: "ci", label: "the image builds", verdict: "pending", settledBy: "the build pipeline" }]);
  assert.match(p, /- ○ the image builds — settled after the merge, by the build pipeline/);
});

test("a reviewer's own words are printed as the reviewer wrote them", () => {
  const said = "RED — Run.tsx never sets card.inCut, so no card in the running product can show it.";
  const p = page([{ kind: "assessment", label: "review-3: an in-cut card still reads as in the cut", verdict: "red", ref: said }]);
  assert.match(p, /Run\.tsx never sets card\.inCut/, "prose needs no translation — only a command does");
});
