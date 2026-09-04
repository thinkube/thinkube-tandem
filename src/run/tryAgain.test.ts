/**
 * The run answers the platform's refusal, twice, and never on hope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ATTEMPTS, repairUntilLive, type TryAgainSteps } from "./tryAgain";
import { namedFiles } from "./live";

/** A loop wired to say what happened, with everything else answering yes. */
function loop(over: Partial<TryAgainSteps>): { steps: TryAgainSteps; said: string[]; pushes: number } {
  const said: string[] = [];
  const box = { pushes: 0 };
  const steps: TryAgainSteps = {
    whyItFailed: async () => ({ evidence: "build-frontend failed: a type error", files: ["frontend/src/a.ts"] }),
    repair: async () => ({ green: true, report: "fixed" }),
    buildsHere: async () => ({ ok: true, output: "" }),
    land: async () => (box.pushes++, { ok: true }),
    waitUntilLive: async () => ({ live: true }),
    say: (l) => said.push(l),
    doing: (l) => said.push(l),
    ...over,
  };
  return { steps, said, get pushes() { return box.pushes; } };
}

test("a refused deployment is repaired, pushed again, and the run ends live", async () => {
  const l = loop({});
  const r = await repairUntilLive(l.steps);
  assert.deepEqual({ live: r.live, attempts: r.attempts, spent: r.spent }, { live: true, attempts: 1, spent: false });
  assert.equal(l.pushes, 1, "one repair, one push");
  assert.ok(
    l.said.some((s) => /trying again \(1 of 2\).*frontend\/src\/a\.ts/.test(s)),
    `and it says what it is repairing: ${l.said.join(" · ")}`,
  );
});

test("two attempts, then it stops and hands the answer back", async () => {
  const l = loop({ waitUntilLive: async () => ({ live: false, why: "build-frontend did not pass" }) });
  const r = await repairUntilLive(l.steps);
  assert.equal(r.live, false);
  assert.equal(r.attempts, ATTEMPTS, "it does not loop for ever");
  assert.equal(r.spent, true, "and it says the attempts are spent, which is what puts the person back in it");
  assert.equal(l.pushes, 2);
  assert.equal(r.why, "build-frontend did not pass", "in the platform's own words");
});

test("a repair that does not build here is never pushed", async () => {
  const l = loop({ buildsHere: async () => ({ ok: false, output: "src/a.ts(1,1): error TS1005" }) });
  const r = await repairUntilLive(l.steps);
  assert.equal(l.pushes, 0, "nothing goes to the project on hope");
  assert.match(r.why ?? "", /does not build here/);
  assert.equal(r.spent, false, "and it stops there rather than spending the second attempt on the same tree");
});

test("a repair the closer could not settle stops the loop and says so", async () => {
  const l = loop({ repair: async () => ({ green: false, report: "UNDELIVERED: the image is missing a package" }) });
  const r = await repairUntilLive(l.steps);
  assert.equal(l.pushes, 0);
  assert.match(r.why ?? "", /did not settle it/);
});

test("a stopped run does not repair anything", async () => {
  const l = loop({ halted: () => true });
  const r = await repairUntilLive(l.steps);
  assert.deepEqual({ live: r.live, attempts: r.attempts, why: r.why }, { live: false, attempts: 0, why: "the run was stopped" });
});

test("the files a tool names are resolved against the parts this repository declares", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-named-"));
  fs.writeFileSync(
    path.join(dir, "thinkube.yaml"),
    `apiVersion: thinkube.io/v1
kind: ThinkubeDeployment
spec:
  deployment:
    type: app
  containers:
    - name: frontend
      build: ./frontend
  routes:
    - path: /
      to: frontend
`,
  );
  fs.mkdirSync(path.join(dir, "frontend/src/lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "frontend/src/lib/taskView.test.tsx"), "");
  assert.deepEqual(
    namedFiles("src/lib/taskView.test.tsx(52,61): error TS2345: not assignable", dir),
    ["frontend/src/lib/taskView.test.tsx"],
    "the compiler speaks from inside its part; the repair needs the repository's path",
  );
  assert.deepEqual(namedFiles("src/lib/nothere.ts(1,1): error", dir), [], "a path that does not exist is not a file");
});
