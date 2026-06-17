/**
 * Unit tests for the orchestrator shell's dispatch wiring (SP-tgs8nz_SL-1), exercised with
 * fakes (store / arbiter / worktrees / spawn) — no real `claude -p`, no vscode. Verifies the
 * orchestration logic (pick → claim → worktree → stream → release); the live worker actually
 * doing useful work stays a human verdict (SP-tgsdvw lever).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OrchestratorService,
  type OrchestratorDeps,
  type SpawnedWorker,
} from "./OrchestratorService";

/** A fake worker that emits one stream-json line then closes, after handlers register. */
function fakeWorker(line: string): SpawnedWorker {
  let dataCb: ((c: string) => void) | undefined;
  return {
    stdout: {
      on: (_e: "data", cb: (c: Buffer | string) => void) => {
        dataCb = cb as (c: string) => void;
      },
    },
    on: (event: string, cb: (arg: never) => void) => {
      if (event === "close") {
        dataCb?.(line);
        (cb as unknown as (code: number | null) => void)(0);
      }
    },
  } as unknown as SpawnedWorker;
}

interface FakeFiles {
  [rel: string]: { status?: string; depends_on?: string[]; files?: string[] };
}

function makeDeps(
  files: FakeFiles,
  opts: { acquireOk?: boolean; line?: string } = {},
): {
  deps: OrchestratorDeps;
  calls: { acquired: string[]; released: string[]; created: number };
} {
  const calls = {
    acquired: [] as string[],
    released: [] as string[],
    created: 0,
  };
  const deps: OrchestratorDeps = {
    store: {
      listSlices: async () => Object.keys(files),
      getFile: async (rel: string) => ({
        frontmatter: files[rel],
        body: "",
        raw: "",
      }),
      sliceHandle: (spec: string, n: number) => `SP-${spec}_SL-${n}`,
    } as unknown as OrchestratorDeps["store"],
    arbiter: {
      acquire: async (slice: string) => {
        calls.acquired.push(slice);
        return opts.acquireOk === false
          ? {
              ok: false as const,
              conflicts: [{ file: "x", heldBy: "SP-1_SL-9" }],
            }
          : { ok: true as const, state: {}, acquired: [] };
      },
      release: async (slice: string) => {
        calls.released.push(slice);
      },
    } as unknown as OrchestratorDeps["arbiter"],
    worktrees: {
      create: async () => {
        calls.created++;
        return "/tmp/wt/SP-1";
      },
    } as unknown as OrchestratorDeps["worktrees"],
    output: { appendLine: () => {} } as unknown as OrchestratorDeps["output"],
    canonicalRepo: "/repo",
    spawnWorker: () =>
      fakeWorker(
        opts.line ?? '{"type":"result","subtype":"success","is_error":false}\n',
      ),
  };
  return { deps, calls };
}

test("dispatchNext: picks the ready+deps-satisfied slice, claims it, runs, releases", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": { status: "done" },
    "specs/SP-1/SL-2.md": {
      status: "ready",
      depends_on: ["SP-1_SL-1"],
      files: ["src/a.ts"],
    },
  });
  const r = await new OrchestratorService(deps).dispatchNext("1");
  assert.equal(r.dispatched, true);
  assert.equal(r.handle, "SP-1_SL-2");
  assert.equal(r.success, true);
  assert.deepEqual(calls.acquired, ["SP-1_SL-2"]);
  assert.deepEqual(calls.released, ["SP-1_SL-2"]); // released even on success
  assert.equal(calls.created, 1);
});

test("dispatchNext: nothing dispatchable → no claim, no worktree", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": { status: "doing" },
    "specs/SP-1/SL-2.md": { status: "ready", depends_on: ["SP-1_SL-1"] },
  });
  const r = await new OrchestratorService(deps).dispatchNext("1");
  assert.equal(r.dispatched, false);
  assert.equal(calls.acquired.length, 0);
  assert.equal(calls.created, 0);
});

test("dispatchNext: ownership conflict → not dispatched, no worktree", async () => {
  const { deps, calls } = makeDeps(
    { "specs/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] } },
    { acquireOk: false },
  );
  const r = await new OrchestratorService(deps).dispatchNext("1");
  assert.equal(r.dispatched, false);
  assert.equal(r.reason, "ownership conflict");
  assert.equal(calls.created, 0);
});

test("dispatchNext: a worker with no success result → success:false (still released)", async () => {
  const { deps, calls } = makeDeps(
    { "specs/SP-1/SL-1.md": { status: "ready" } },
    {
      line: '{"type":"result","subtype":"error_during_execution","is_error":true}\n',
    },
  );
  const r = await new OrchestratorService(deps).dispatchNext("1");
  assert.equal(r.dispatched, true);
  assert.equal(r.success, false);
  assert.deepEqual(calls.released, ["SP-1_SL-1"]);
});
