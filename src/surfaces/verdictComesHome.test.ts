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
import { watchGitopsAfterAccept } from "../run/harvest";
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

test("merged work that broke is signed work waiting to run again", () => {
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
  assert.deepEqual(unrunCutOf(space), { id: "cut-1", tepId: "TEP-1" });
  // The same delivery, once the world says the work held, is finished.
  const held = { ...space, deliveries: [{ ...space.deliveries[0], afterMerge: { ...space.deliveries[0].afterMerge!, outcome: "held" as const } }] };
  assert.equal(unrunCutOf(held), undefined);
});
