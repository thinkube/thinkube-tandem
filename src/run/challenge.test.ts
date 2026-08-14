import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeChallenge, OracleFactoryArgs } from "./oracle";

const PROBE = "probes/space__SL-1_AC-1.test.mjs";

function world(rule: string) {
  const testerWt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-challenge-"));
  fs.mkdirSync(path.join(testerWt, "probes"), { recursive: true });
  fs.writeFileSync(path.join(testerWt, PROBE), "assert(panel.style === 'blue')");
  const rulings: { criterionId: string; granted: boolean; reason: string }[] = [];
  const persisted: string[] = [];
  const authored: { rel: string; prompt: string }[] = [];
  const args = {
    testerWt,
    sliceProbes: new Map([["SL-1", [PROBE]]]),
    model: "opus",
    criterionOf: (slice: string, ac: number) =>
      slice === "SL-1" && ac === 1
        ? { id: "c1", text: "the panel follows the running step" }
        : undefined,
    onRuling: (r: { slice: string; criterionId: string; granted: boolean; reason: string }) =>
      rulings.push(r),
    persistProbe: async (rel: string) => {
      persisted.push(rel);
    },
    supervisorRound: async () => rule,
    author: async (deps: { allowWrite: string[] }, prompt: string) => {
      authored.push({ rel: deps.allowWrite[0], prompt });
      fs.writeFileSync(path.join(testerWt, deps.allowWrite[0]), "rewritten from criterion");
      return "done";
    },
    log: () => {},
    defect: () => {},
  } as unknown as OracleFactoryArgs;
  return { testerWt, rulings, persisted, authored, challenge: makeChallenge(args)("SL-1") };
}

test("a granted challenge re-authors the check from its criterion, on the record", async () => {
  const w = world("DEFECTIVE\nthe probe pins a color the criterion never names");
  const reply = await w.challenge(1, "no correct implementation can satisfy a hardcoded color");
  assert.match(reply, /GRANTED/);
  assert.match(reply, /re-authored/);
  assert.equal(w.rulings[0].criterionId, "c1");
  assert.equal(w.rulings[0].granted, true);
  assert.deepEqual(w.persisted, [PROBE], "the rewritten probe outlives the next snapshot");
  assert.equal(
    fs.readFileSync(path.join(w.testerWt, PROBE), "utf8"),
    "rewritten from criterion",
  );
  assert.ok(
    w.authored[0].prompt.includes("the panel follows the running step"),
    "the re-author works from the criterion, never from the coder's argument",
  );
  assert.ok(
    !w.authored[0].prompt.includes("hardcoded color"),
    "the coder's argument is not the spec",
  );
});

test("a denied challenge stands the check and still lands on the record", async () => {
  const w = world("FAITHFUL\nthe probe asserts exactly what the criterion states");
  const reply = await w.challenge(1, "this is just hard");
  assert.match(reply, /DENIED/);
  assert.equal(w.rulings[0].granted, false);
  assert.equal(w.authored.length, 0, "nothing is rewritten");
  assert.equal(w.persisted.length, 0);
});

test("the challenge budget is a valve, not a grinding strategy", async () => {
  const w = world("FAITHFUL\nstands");
  await w.challenge(1, "a");
  await w.challenge(1, "b");
  const third = await w.challenge(1, "c");
  assert.ok(!/GRANTED|DENIED/.test(third), "the third is refused, not ruled");
  assert.equal(w.rulings.length, 2, "the refused third is not a ruling");
});

test("a challenge to a check that does not exist is answered, not invented", async () => {
  const w = world("DEFECTIVE\nwould grant");
  const reply = await w.challenge(9, "x");
  assert.ok(!/GRANTED|DENIED/.test(reply), "nothing was ruled");
  assert.equal(w.rulings.length, 0);
  assert.equal(w.authored.length, 0, "and nothing was rewritten");
});
