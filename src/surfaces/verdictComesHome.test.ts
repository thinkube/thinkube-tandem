/**
 * What the platform did with merged work reaches the space even when the
 * window was not open to hear it.
 *
 * The verdict was watched only from the accept that started it, so a
 * window closed, reloaded, or opened on another machine never heard the
 * answer: a delivery whose merged tree broke the build stayed "accepted,
 * every check green" for ever, with nothing to press.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stepJudged, watchGitopsAfterAccept } from "../run/harvest";
import { unrunCutOf } from "./runGate";
import { emptySpace, type Delivery, type Space } from "../core/schema";

function pipeline(phase: string, stages: { name: string; status: string }[]) {
  return async (url: string) => {
    if (url.endsWith("/pipelines")) return { pipelines: [{ name: "todo-build-1", appName: "todo", status: phase, startedAt: "2026-01-02T00:00:00Z" }] };
    return { status: phase, stages };
  };
}

async function ask(phase: string, stages: { name: string; status: string }[]): Promise<{ d: Delivery; notes: string[] }> {
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-todo-"));
  let d: Delivery = { id: "delivery-TEP-1", cutId: "cut-1", branch: "tandem/x/TEP-1", proofs: [], acceptedAt: "2026-01-01T00:00:00Z" } as never;
  const notes: string[] = [];
  await watchGitopsAfterAccept({
    gitRoot,
    app: "todo",
    delivery: d,
    acceptedAt: "2026-01-01T00:00:00Z",
    update: (updated, note) => {
      d = updated;
      notes.push(note);
    },
    log: (l) => notes.push(l),
    http: pipeline(phase, stages) as never,
    sleep: async () => {},
    remote: "https://git.thinkube.com/thinkube-deployments/todo.git",
    token: "t",
  });
  return { d, notes };
}

test("a pipeline that failed lands on the delivery, in its own words", async () => {
  const { d, notes } = await ask("Failed", [
    { name: "build-backend", status: "Succeeded" },
    { name: "test-frontend", status: "Failed" },
  ]);
  assert.equal(d.afterMerge?.outcome, "broke");
  assert.equal(d.afterMerge?.said, "the platform's pipeline");
  assert.match(d.afterMerge?.detail ?? "", /test-frontend/);
  assert.ok(notes.some((n) => /the merged work did not build/.test(n)));
});

test("a pipeline that succeeded lands too, so 'not known yet' is never mistaken for 'it held'", async () => {
  const { d } = await ask("Succeeded", [{ name: "build-backend", status: "Succeeded" }]);
  assert.equal(d.afterMerge?.outcome, "held");
});

test("merged work the platform judged wanting is not a cut to run again — its promises are work", () => {
  const space: Space = {
    ...emptySpace(),
    cuts: [{ id: "cut-1", tepId: "TEP-1", changeIds: ["n1"], askIds: ["a1"], signature: "s" }] as never,
    deliveries: [
      {
        id: "delivery-TEP-1",
        cutId: "cut-1",
        branch: "b",
        proofs: [],
        acceptedAt: "2026-01-01T00:00:00Z",
        afterMerge: { at: "2026-01-02T00:00:00Z", outcome: "broke", said: "the platform's pipeline", detail: "test-frontend — this step did not pass" },
      },
    ] as never,
  };
  // An accepted cut is history whatever the world then said: nothing is
  // re-run. What comes back is the promises, through the contradictions
  // the verdict wrote, and the ordinary Build press repairs them.
  assert.equal(unrunCutOf(space), undefined);
});

test("the platform's own shape is read: epoch clocks, an id, uppercase words, and the step's message", async () => {
  // What control actually returns for an app's pipelines. Read as ISO
  // strings and camel names, every run sorted before every accept and the
  // answer was never found at all.
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-todo-"));
  let d: Delivery = { id: "delivery-TEP-3", cutId: "cut-3", branch: "b", proofs: [], acceptedAt: "2026-09-03T10:24:00.000Z" } as never;
  const http = async (url: string) => {
    if (url.endsWith("/pipelines"))
      return {
        pipelines: [
          { id: "todo-build-jc46h", appName: "todo", status: "FAILED", startedAt: 1788431103.0, name: null },
          { id: "todo-build-old", appName: "todo", status: "SUCCEEDED", startedAt: 1788429175.0, name: null },
        ],
      };
    assert.match(url, /todo-build-jc46h$/, "the newest run for this app is the one read");
    return {
      status: "FAILED",
      stages: [
        { stageName: "build-backend", status: "SUCCEEDED" },
        { stageName: "run-test", component: "run-test", status: "FAILED", errorMessage: "main: Error (exit code 1)" },
      ],
    };
  };
  await watchGitopsAfterAccept({
    gitRoot,
    app: "todo",
    delivery: d,
    acceptedAt: "2026-09-03T10:24:00.000Z",
    update: (u) => {
      d = u;
    },
    log: () => {},
    http: http as never,
    sleep: async () => {},
    remote: "https://git.thinkube.com/thinkube-deployments/todo.git",
    token: "t",
  });
  assert.equal(d.afterMerge?.outcome, "broke");
  assert.match(d.afterMerge?.detail ?? "", /run-test \(main: Error \(exit code 1\)\)/);
});

test("a step that could not run judges nothing, and a step that judged says so", () => {
  // The machinery, in its own words: nothing about the work is known.
  for (const log of [
    "npm error code EACCES\nnpm error syscall mkdir\nnpm error path /workspace",
    "Error: ImagePullBackOff",
    "context deadline exceeded",
  ])
    assert.equal(stepJudged(log).judged, false, log.split("\n")[0]);

  // A runner or a compiler that reached a verdict.
  for (const log of [
    " FAIL  src/views/__tests__/Home.test.js > Home.vue > opens a question\n Tests  1 failed | 71 passed",
    "not ok 3 - the list is sorted",
    "src/a.ts(4,1): error TS2304: Cannot find name 'x'",
  ])
    assert.equal(stepJudged(log).judged, true, log.split("\n")[0]);

  assert.match(stepJudged(" FAIL  src/views/__tests__/Home.test.js > Home.vue").said, /FAIL/);
  assert.match(stepJudged("npm error code EACCES\nnpm error path /workspace").said, /EACCES|workspace/);
});

test("the platform that could not judge makes no work, and can be asked again", async () => {
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-todo-"));
  let d: Delivery = { id: "delivery-TEP-4", cutId: "cut-4", branch: "b", proofs: [], acceptedAt: "2026-09-03T10:24:00.000Z" } as never;
  const http = async (url: string) => {
    if (url.endsWith("/pipelines")) return { pipelines: [{ id: "todo-build-x", appName: "todo", status: "FAILED", startedAt: 1788431103.0 }] };
    if (url.includes("/logs/")) return { logs: "npm error code EACCES\nnpm error path /workspace" };
    return { status: "FAILED", stages: [{ stageName: "run-test", status: "FAILED", errorMessage: "main: Error (exit code 1)", podName: "p-1" }] };
  };
  await watchGitopsAfterAccept({
    gitRoot,
    app: "todo",
    delivery: d,
    acceptedAt: "2026-09-03T10:24:00.000Z",
    update: (u) => {
      d = u;
    },
    log: () => {},
    http: http as never,
    sleep: async () => {},
    remote: "https://git.thinkube.com/thinkube-deployments/todo.git",
    token: "t",
  });
  assert.equal(d.afterMerge?.outcome, "unjudged", "a cache it could not write is not the work failing");
  assert.match(d.afterMerge?.detail ?? "", /could not run/);
});
