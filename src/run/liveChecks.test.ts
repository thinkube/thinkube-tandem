/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A criterion only the running service can answer becomes a live check: a
 * check minted in the repository's live home, never run at the gate, and
 * run against the deployed service once the work is live. Its exit
 * settles the criterion, and a red goes back to be repaired with the
 * check's own output. Every command, and control itself, is injected.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { tepSlices } from "../dispatch/adapter";
import { LIVE_SETTLING, TEMPLATE_SETTLING } from "../derive/ground";
import type { Change, Cut, Delivery, Space } from "../core/schema";
import { houseLiveChecks, rehouseChecks, unreachableCheckHomes } from "./checkHomes";
import { judgeByLiveChecks, liveChecksOf, liveVerdict, runLiveChecks, type LiveCheck } from "./liveChecks";
import { liveHomeRefusal } from "./liveSuite";
import { closingVerifications, sliceBookkeeping } from "./plan";
import { proved, runnerFor } from "./proved";
import { repairWhatDidNotHold, whatDidNotHold } from "./repairOnTheProduct";
import { RunState, type DispatchOutcome } from "./state";

const space = (): Space =>
  ({
    asks: [{ id: "ask-1", text: "the storage keeps documents" }],
    nodes: [
      {
        id: "n1",
        sentence: "the storage service keeps a document's XLIFF",
        serves: ["ask-1"],
        needs: [],
        grounding: { touchpoints: [{ path: "app/storage.py" }], stamp: [] },
        acceptance: [
          { id: "c1", text: "a stored key is read back as the same bytes" },
          { id: "c2", text: "the storage service returns the document's XLIFF for a key", settledBy: TEMPLATE_SETTLING },
          { id: "c3", text: "the image builds in the pipeline", settledBy: "the build" },
        ],
      } as unknown as Change,
    ],
    subjects: [],
    claims: [],
    cuts: [],
    deliveries: [],
  }) as unknown as Space;

const cut: Cut = { id: "cut-1", changeIds: ["n1"] } as unknown as Cut;
const REPO = ["app/storage.py", "tests/test_storage.py", "thinkube.yaml"];
const runOne = runnerFor(proved("python3 -m pytest -q <file>", true)!);

/** The plan a run makes: the adapter's slices, housed as the run houses them. */
function plan(live: boolean) {
  const slices = tepSlices({ space: space(), cut, spaceName: "s", live });
  if (live) houseLiveChecks(slices, "live", REPO);
  rehouseChecks(slices, REPO);
  return slices;
}

test("without live checks declared, a criterion settled on the running product gets no check", () => {
  const tests = plan(false)[0].workUnits.filter((u) => u.role === "test");
  assert.equal(tests.length, 1, "only the criterion a worktree can answer");
});

test("a live-settled criterion's check is minted under live.home, and the others where the unit tests live", () => {
  const slices = plan(true);
  const files = slices[0].workUnits.filter((u) => u.role === "test").map((u) => u.footprint[0]);
  assert.deepEqual(files, ["tests/storage_AC-1_test.py", "live/storage_AC-2_test.py"]);
  assert.deepEqual(unreachableCheckHomes(slices, REPO).where, [], "a live check is not refused for living outside the unit suite");
  assert.deepEqual(
    liveChecksOf(slices, space()),
    [{ path: "live/storage_AC-2_test.py", criterionId: "c2", label: "the storage service returns the document's XLIFF for a key", promise: "the storage service keeps a document's XLIFF" }],
  );
});

test("a live check is never run at the gate or by a slice's oracle, and still rides the slice", () => {
  const slices = plan(true);
  const book = sliceBookkeeping(slices, runOne);
  assert.ok(book.sliceProbes.get(slices[0].handle)!.includes("live/storage_AC-2_test.py"), "it rides the slice's commit");
  assert.deepEqual(book.sliceVerifs.get(slices[0].handle)!.map((v) => v.run), ["python3 -m pytest -q tests/storage_AC-1_test.py"]);
  assert.deepEqual(closingVerifications(slices, runOne).verifs.map((v) => v.run), ["python3 -m pytest -q tests/storage_AC-1_test.py"]);
});

test("a live home is refused inside the unit suite's directory or a declared part, and accepted apart from them", () => {
  assert.match(liveHomeRefusal("tests/live", REPO, []) ?? "", /inside `tests`, where the unit suite's tests live/);
  assert.match(liveHomeRefusal("app/live", REPO, [{ root: "app" }]) ?? "", /inside the declared part `app`/);
  assert.match(liveHomeRefusal("tests", REPO, []) ?? "", /already holds the unit test tests\/test_storage\.py/);
  assert.equal(liveHomeRefusal("live", [...REPO, "live/storage_AC-2_test.py"], [{ root: "." }]), undefined);
});

test("a live check's exit: 0 is green, a runner's failure is red, a command that ran no check is unjudged", () => {
  assert.equal(liveVerdict(0, "1 passed"), "green");
  assert.equal(liveVerdict(1, "FAILED live/x_AC-1_test.py::test_xliff - assert 404 == 200\n1 failed in 0.4s"), "red");
  assert.equal(liveVerdict(1, "Ran 1 test in 0.1s\n\nFAILED (failures=1)"), "red");
  assert.equal(liveVerdict(127, "bash: line 1: pytest: command not found"), "unjudged");
  assert.equal(liveVerdict(5, "no tests ran in 0.01s"), "unjudged");
  assert.equal(liveVerdict(4, "ERROR: file or directory not found: live/x_AC-1_test.py"), "unjudged");
});

/** A delivered tree holding the live checks, and the command each one ran with. */
function delivered(files: string[]) {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-live-"));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(tree, f)), { recursive: true });
    fs.writeFileSync(path.join(tree, f), "def test_it(): pass\n");
  }
  return tree;
}

const check = (n: number, promise = "the storage service keeps a document's XLIFF"): LiveCheck => ({
  path: `live/storage_AC-${n}_test.py`,
  criterionId: `c${n}`,
  label: `criterion ${n}`,
  promise,
});
const control = () => ({ base: "https://control.example.com", token: "tok" });

test("the live phase runs each live check with live.one, in the delivered tree, told the address and control", async () => {
  const tree = delivered(["live/storage_AC-1_test.py", "live/storage_AC-2_test.py", "live/storage_AC-3_test.py"]);
  const ran: { command: string; cwd: string; env?: Record<string, string> }[] = [];
  const answers: Record<string, { code: number; out: string }> = {
    "live/storage_AC-1_test.py": { code: 0, out: "1 passed in 0.2s" },
    "live/storage_AC-2_test.py": { code: 1, out: "E   assert 404 == 200\n1 failed in 0.3s" },
    "live/storage_AC-3_test.py": { code: 127, out: "bash: pytest: command not found" },
  };
  const proofs = await runLiveChecks({
    checks: [check(1), check(2), check(3), check(4)],
    one: "pytest -q <file>",
    tree,
    at: "https://svc.example.com",
    control,
    run: async (command, cwd, env) => {
      ran.push({ command, cwd, ...(env ? { env } : {}) });
      return answers[command.replace("pytest -q ", "")];
    },
    log: () => {},
  });
  assert.deepEqual(ran.map((r) => r.command), ["pytest -q live/storage_AC-1_test.py", "pytest -q live/storage_AC-2_test.py", "pytest -q live/storage_AC-3_test.py"]);
  assert.ok(ran.every((r) => r.cwd === tree), "in the delivery's tree");
  assert.deepEqual(ran[0].env, {
    TANDEM_LIVE_URL: "https://svc.example.com",
    THINKUBE_CONTROL_URL: "https://control.example.com",
    THINKUBE_API_TOKEN: "tok",
  });
  assert.deepEqual(proofs.map((p) => [p.criterionId, p.verdict]), [["c1", "green"], ["c2", "red"], ["c3", "unjudged"], ["c4", "unjudged"]]);
  assert.match(proofs[0].ref!, /^live check live\/storage_AC-1_test\.py: exit 0 — 1 passed/);
  assert.match(proofs[1].ref!, /^live check live\/storage_AC-2_test\.py: exit 1 — E {3}assert 404 == 200/);
  assert.match(proofs[2].ref!, /could not run a check \(exit 127\) — bash: pytest: command not found/);
  assert.match(proofs[3].ref!, /not run — the check is not in the delivered tree/);
});

test("a live check that cannot be given control's token is unjudged, never red", async () => {
  const tree = delivered(["live/storage_AC-1_test.py"]);
  let ran = 0;
  const proofs = await runLiveChecks({
    checks: [check(1)],
    one: "pytest <file>",
    tree,
    at: "https://svc.example.com",
    control: () => ({ reason: "no thinkube-control entry in ~/.claude.json" }),
    run: async () => {
      ran++;
      return { code: 0, out: "" };
    },
    log: () => {},
  });
  assert.equal(ran, 0);
  assert.equal(proofs[0].verdict, "unjudged");
  assert.match(proofs[0].ref!, /thinkube-control cannot be reached for its address and token: no thinkube-control entry/);
});

/** A delivery waiting on the live checks, as going live leaves it. */
const waiting = (): Delivery =>
  ({
    id: "d1",
    cutId: "cut-1",
    branch: "b",
    proofs: [
      { kind: "probe", label: "a stored key is read back as the same bytes", verdict: "green", criterionId: "c1" },
      {
        kind: "staged",
        label: "the storage service returns the document's XLIFF for a key",
        verdict: "pending",
        settledBy: LIVE_SETTLING,
        criterionId: "c2",
      },
    ],
  }) as unknown as Delivery;

test("a red live check goes to repair with its own output, and the checks are run again", async () => {
  const tree = delivered(["live/storage_AC-2_test.py"]);
  let fixed = false;
  const run = async () =>
    fixed ? { code: 0, out: "1 passed" } : { code: 1, out: "E   KeyError: 'xliff'\n1 failed in 0.3s" };
  const judge = async (d: Delivery, only?: (p: string) => boolean) =>
    judgeByLiveChecks({
      delivery: d,
      checks: [check(2)],
      ...(only ? { only } : {}),
      suite: { home: "live", one: "pytest <file>", at: "https://svc.example.com" },
      tree,
      control,
      run,
      log: () => {},
      doing: () => {},
    });
  let outcome: DispatchOutcome = { refusals: [], undelivered: [], delivery: await judge(waiting()) } as DispatchOutcome;
  const red = outcome.delivery!.proofs.find((p) => p.criterionId === "c2")!;
  assert.equal(red.verdict, "red");
  assert.equal(red.settledBy, LIVE_SETTLING, "it still says what settles it");
  assert.equal(outcome.delivery!.proofs.filter((p) => p.criterionId === "c2").length, 1, "one answer per criterion");

  const evidence: string[] = [];
  outcome = await repairWhatDidNotHold({
    st: new RunState(() => {}),
    say: () => {},
    doing: () => {},
    repair: async (found) => {
      evidence.push(found.evidence);
      fixed = true;
      return { green: true, report: "" };
    },
    buildsHere: async () => ({ ok: true, output: "" }),
    land: async () => ({ ok: true, moved: true }),
    waitUntilLive: async () => ({ live: true }),
    judgeAgain: async (promises) => ({
      ...outcome,
      delivery: await judge(outcome.delivery!, (p) => promises.includes(p)),
    }),
    outcome,
    space: space(),
    cut,
  });
  assert.equal(evidence.length, 1);
  assert.match(evidence[0], /── the storage service keeps a document's XLIFF\n {2}- criterion 2\n/, "the promise and its criterion");
  assert.match(evidence[0], /live check live\/storage_AC-2_test\.py: exit 1 — E {3}KeyError: 'xliff'/, "the check's own output is the evidence");
  assert.equal(outcome.delivery!.proofs.find((p) => p.criterionId === "c2")!.verdict, "green", "judged again after the repair");
  assert.equal(whatDidNotHold({ space: space(), cut, outcome }), undefined);
});
