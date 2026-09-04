/**
 * The wait for a deployment says what it is waiting on, at every moment.
 *
 * Between the last check and the first assessor there are about ten
 * minutes: the platform noticing a push, building an image for each
 * architecture, taking it live, the app answering. A person watching that
 * as one spinner cannot tell a build from a hang.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitUntilLive } from "./goLive";
import type { PipelineReading } from "./harvest";

function watcher() {
  const said: string[] = [];
  const doing: string[] = [];
  return { said, doing, step: { say: (l: string) => said.push(l), doing: (l: string) => doing.push(l) } };
}

const reading = (over: Partial<PipelineReading>): PipelineReading => ({ settled: false, stages: [], ...over });

test("it names the wait: noticing the push, then the step being built, then the address", async () => {
  const w = watcher();
  const readings: PipelineReading[] = [
    reading({ unreachable: "no pipeline yet" }),
    reading({ stages: [{ name: "run-test", status: "SUCCEEDED" }, { name: "build-amd64", status: "RUNNING" }, { name: "build-arm64", status: "PENDING" }] }),
    reading({ settled: true, phase: "SUCCEEDED", stages: [{ name: "run-test", status: "SUCCEEDED" }] }),
  ];
  let i = 0;
  const knocks: (number | undefined)[] = [undefined, 200];
  let k = 0;
  const r = await waitUntilLive({
    at: "https://todo.thinkube.com",
    app: "todo",
    since: "2026-01-01T00:00:00Z",
    read: async () => readings[Math.min(i++, readings.length - 1)],
    knock: async () => knocks[Math.min(k++, knocks.length - 1)],
    step: w.step,
    sleep: async () => {},
  });
  assert.deepEqual(r, { live: true });
  assert.ok(w.doing.includes("waiting for the platform to notice the push"), w.doing.join(" | "));
  assert.ok(w.doing.some((l) => /build-amd64 — 1 of 3 steps/.test(l)), w.doing.join(" | "));
  assert.ok(w.doing.some((l) => /waiting for https:\/\/todo\.thinkube\.com to answer/.test(l)));
  assert.ok(w.said.some((l) => /it is live at https:\/\/todo\.thinkube\.com/.test(l)));
});

test("a build that fails ends the wait, in the failing step's own words", async () => {
  const w = watcher();
  const r = await waitUntilLive({
    at: "https://todo.thinkube.com",
    app: "todo",
    since: "2026-01-01T00:00:00Z",
    read: async () =>
      reading({
        settled: true,
        phase: "FAILED",
        stages: [
          { name: "run-test", status: "FAILED", said: "1 failed, 19 passed" },
          { name: "build-amd64", status: "SUCCEEDED" },
        ],
      }),
    knock: async () => 200,
    step: w.step,
    sleep: async () => {},
  });
  assert.equal(r.live, false);
  assert.match(r.why ?? "", /run-test \(1 failed, 19 passed\) did not pass/);
  assert.ok(w.said.some((l) => /did not go live/.test(l)));
});

test("built, but the address never answers: that is what it says, not 'failed'", async () => {
  const w = watcher();
  const r = await waitUntilLive({
    at: "https://todo.thinkube.com",
    app: "todo",
    since: "2026-01-01T00:00:00Z",
    read: async () => reading({ settled: true, phase: "SUCCEEDED", stages: [{ name: "run-test", status: "SUCCEEDED" }] }),
    knock: async () => undefined,
    step: w.step,
    sleep: async () => {},
    patience: 3,
  });
  assert.equal(r.live, false);
  assert.match(r.why ?? "", /never answered/);
});

test("a server error is not an answer: 500 keeps it waiting", async () => {
  const w = watcher();
  const r = await waitUntilLive({
    at: "https://todo.thinkube.com",
    app: "todo",
    since: "2026-01-01T00:00:00Z",
    read: async () => reading({ settled: true, phase: "SUCCEEDED", stages: [] }),
    knock: async () => 503,
    step: w.step,
    sleep: async () => {},
    patience: 3,
  });
  assert.equal(r.live, false);
});
