/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A template's live phase runs its declared deploy.
 *
 * A push of a template builds nothing, so a run that waited for the
 * platform to notice the push sat for fifteen minutes and never judged the
 * live product. The template is made live by its validation deployment;
 * live, it is judged; refused, the refusal is said in the deploy's own
 * words — repaired when those words judged the work, left alone when the
 * deploy could not run at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { goLiveAndJudge } from "./goingLive";
import { templateGoesLive } from "./templateLive";
import type { Delivery } from "../core/schema";

const MERGED = "f".repeat(40);
const RELEASE = "9".repeat(40);

function template(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-golive-"));
  fs.writeFileSync(
    path.join(root, "thinkube.yaml"),
    [
      "spec:",
      "  containers:",
      "    - name: svc",
      "      build: .",
      "      health: /health",
      "  deploy:",
      "    run: python3 scripts/deploy.py svc",
      "    at: https://svc.example.com",
    ].join("\n"),
  );
  return root;
}

const delivered = (): Delivery =>
  ({
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/x/TEP-1",
    mergedHead: MERGED,
    proofs: [
      {
        kind: "staged",
        label: "the deployed service answers /segments",
        verdict: "pending",
        settledBy: "a validation deployment of the template through thinkube-control",
        criterionId: "c1",
      },
    ],
  }) as never;

/** One live phase of a template run, every effect recorded. */
async function phaseOf(deployFails?: string) {
  const root = template();
  const state = { head: MERGED, common: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-golive-git-")) };
  const deploys: string[] = [];
  const byDeploy = templateGoesLive({
    repoRoot: root,
    exec: async (_cmd, args) =>
      args[2] === "rev-parse"
        ? { code: 0, out: `${args[3] === "--git-common-dir" ? state.common : state.head}\n` }
        : { code: 0, out: "" },
    log: () => {},
    invoke: async (command) => {
      deploys.push(command);
      if (deployFails) return { code: 1, out: deployFails };
      state.head = RELEASE;
      return { code: 0, out: "Release v0.1.1" };
    },
    http: async () => new Response("ok", { status: 200 }),
    control: () => ({ base: "https://control.example.com", token: "tok" }),
    wait: async () => {},
  });
  const seen = {
    phases: [] as string[],
    blocked: [] as string[],
    repairs: [] as string[],
    judged: 0,
    recorded: undefined as Delivery | undefined,
  };
  await goLiveAndJudge({
    at: "https://svc.example.com",
    delivery: delivered(),
    waiting: "deploying it as the repository declares",
    goLive: byDeploy.goLive,
    whyItFailed: byDeploy.whyItFailed,
    said: "a validation deployment through thinkube-control",
    settle: byDeploy.settle,
    repair: async (found) => {
      seen.repairs.push(found.evidence);
      return { green: false, report: "the tests still fail" };
    },
    buildsHere: async () => ({ ok: true, output: "" }),
    land: async () => ({ ok: true, moved: true }),
    halted: () => false,
    say: () => {},
    phase: (s, note) => seen.phases.push(`${s}: ${note}`),
    noProduct: (why) => seen.blocked.push(why),
    record: (d) => {
      seen.recorded = d;
    },
    judge: async () => {
      seen.judged++;
    },
  });
  return { ...seen, deploys, state };
}

test("a template is made live by its own deploy, and judged on the live product", async () => {
  const r = await phaseOf();
  assert.deepEqual(r.deploys, ["python3 scripts/deploy.py svc"], "the declared deploy ran, nothing waited on a pipeline");
  assert.equal(r.phases[0], "running: deploying it as the repository declares");
  assert.equal(r.phases.at(-1), "done: live at https://svc.example.com");
  assert.equal(r.judged, 1, "the live product is judged");
  assert.deepEqual(r.blocked, []);
  assert.equal(r.recorded?.liveAt, "https://svc.example.com");
  assert.equal(r.recorded?.proofs[0].verdict, "green", "the promise settled by the deploy is answered");
  assert.equal(r.recorded?.afterMerge?.outcome, "held");
  assert.equal(
    fs.readFileSync(path.join(r.state.common, "tandem", "deployed"), "utf8").trim(),
    RELEASE,
    "the release commit the deploy left is recorded, so Accept does not deploy it again",
  );
});

test("a deploy whose words judged the work is repaired from those words, and said when it stays refused", async () => {
  const words = "FAILED tests/test_segments.py::test_markup - AssertionError: placeholders lost";
  const r = await phaseOf(words);
  assert.equal(r.judged, 0, "nothing is judged on a product that is not live");
  assert.equal(r.repairs.length, 1, "the repair path is taken");
  assert.match(r.repairs[0], /FAILED tests\/test_segments\.py::test_markup/, "the repair works from the deploy's own words");
  assert.equal(r.recorded?.afterMerge?.outcome, "broke");
  assert.match(r.blocked[0] ?? "", /the repair did not settle it/);
});

test("a deploy that could not run is reported in its own words, and nothing is repaired", async () => {
  const words = "Error: THINKUBE_API_TOKEN is not set — unauthorized";
  const r = await phaseOf(words);
  assert.equal(r.repairs.length, 0, "a repair after no fault changes nothing");
  assert.equal(r.judged, 0);
  assert.match(r.phases.at(-1) ?? "", /^failed: `python3 scripts\/deploy\.py svc` exited 1\nError: THINKUBE_API_TOKEN is not set/);
  assert.match(r.blocked[0] ?? "", /THINKUBE_API_TOKEN is not set/);
  assert.equal(r.recorded?.afterMerge?.outcome, "unjudged");
  assert.match(r.recorded?.afterMerge?.detail ?? "", /THINKUBE_API_TOKEN is not set/);
  assert.equal(r.recorded?.afterMerge?.said, "a validation deployment through thinkube-control");
});
