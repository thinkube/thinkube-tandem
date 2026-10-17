/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A template deploy that fails in its build's test step is judged by that
 * step's log, read from thinkube-control: the deploy's own output names
 * the failed workflow and its steps, never the test lines.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { failedWorkflowOf, templateGoesLive } from "./templateLive";

const DEPLOY_OUTPUT = [
  "deploy: redeploying scoring (f9b78c67)",
  "deploy: the redeploy failed: Deployment failed with return code 1:",
  "[10:04:41.877] [ERROR]   ❌ scoring-build-qg7xs: Failed",
  "[10:04:41.877] [ERROR]   ❌ test-scoring: Failed",
  "[10:04:41.877] [ERROR]   ❌ run-test: Failed",
  "[10:04:41.878] [ERROR] ❌ Build workflow failed: child 'scoring-build-qg7xs-123' failed",
  "[10:04:41.878] [ERROR] 🔗 View failure details: https://argo.example.com/workflows/argo/scoring-build-qg7xs",
].join("\n");

const PYTEST_LOG = [
  "....F.",
  "FAILED tests/compare_AC-10_test.py::test_refuses - assert 401 == 422",
  "1 failed, 5 passed in 3.1s",
].join("\n");

function template(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-templatelive-"));
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "tests", "compare_AC-10_test.py"), "def test_refuses(): pass\n");
  fs.writeFileSync(
    path.join(root, "thinkube.yaml"),
    [
      "spec:",
      "  containers:",
      "    - name: scoring",
      "      build: .",
      "      health: /health",
      "  deploy:",
      "    run: python3 scripts/deploy.py scoring",
      "    at: https://scoring.example.com",
    ].join("\n"),
  );
  return root;
}

function live(control: (url: string) => Response) {
  const root = template();
  const common = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-templatelive-git-"));
  const asked: string[] = [];
  const byDeploy = templateGoesLive({
    repoRoot: root,
    exec: async (_cmd, args) =>
      args[2] === "rev-parse" ? { code: 0, out: `${args[3] === "--git-common-dir" ? common : "f".repeat(40)}\n` } : { code: 0, out: "" },
    log: () => {},
    invoke: async () => ({ code: 1, out: DEPLOY_OUTPUT }),
    http: async (url) => {
      asked.push(String(url));
      return control(String(url));
    },
    control: () => ({ base: "https://control.example.com", token: "tok" }),
    wait: async () => {},
  });
  return { byDeploy, asked };
}

test("the failed workflow is named from the deploy's own words", () => {
  assert.equal(failedWorkflowOf(DEPLOY_OUTPUT), "scoring-build-qg7xs");
  assert.equal(failedWorkflowOf("Error: THINKUBE_API_TOKEN is not set"), undefined);
});

test("a failed test step is judged by its log from Control, and the repair works from that log", async () => {
  const { byDeploy, asked } = live((url) =>
    url.endsWith("/api/v1/cicd/pipelines/scoring-build-qg7xs")
      ? Response.json({
          stages: [
            { stageName: "test-scoring", status: "SUCCEEDED", podName: "scoring-build-qg7xs-1" },
            { stageName: "run-test", status: "FAILED", podName: "scoring-build-qg7xs-2" },
          ],
        })
      : url.includes("/logs/scoring-build-qg7xs-2")
        ? Response.json({ logs: PYTEST_LOG })
        : new Response("unexpected", { status: 500 }),
  );
  const went = await byDeploy.goLive();
  assert.equal(went.live, false);
  assert.equal(went.unjudged, undefined, "the step's log judged the work");
  assert.ok(asked.some((u) => /\/logs\/scoring-build-qg7xs-2\?tail_lines=/.test(u)), asked.join(" | "));
  assert.ok(!asked.some((u) => u.includes("scoring-build-qg7xs-1")), "only a failed step's log is read");
  const found = await byDeploy.whyItFailed();
  assert.match(found.evidence, /FAILED tests\/compare_AC-10_test\.py::test_refuses/);
  assert.deepEqual(found.files, ["tests/compare_AC-10_test.py"]);
});

test("a log Control does not give leaves the refusal unjudged, in Control's words", async () => {
  const { byDeploy } = live((url) =>
    url.endsWith("/pipelines/scoring-build-qg7xs")
      ? Response.json({ stages: [{ stageName: "run-test", status: "FAILED", podName: "scoring-build-qg7xs-2" }] })
      : Response.json({ detail: "Pod not found. Logs may no longer be available." }, { status: 404 }),
  );
  const went = await byDeploy.goLive();
  assert.equal(went.unjudged, true);
  assert.match(went.why ?? "", /could not be read: Control answered 404 .*Pod not found\. Logs may no longer be available\./);
});
