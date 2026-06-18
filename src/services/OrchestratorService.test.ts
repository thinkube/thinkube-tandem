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
  [rel: string]: {
    status?: string;
    depends_on?: string[];
    files?: string[];
    work_units?: { footprint: string[]; execution: string }[];
  };
}

function makeDeps(
  files: FakeFiles,
  opts: { acquireOk?: boolean; line?: string; verifyOk?: boolean } = {},
): {
  deps: OrchestratorDeps;
  calls: {
    acquired: string[];
    released: string[];
    advanced: string[];
    created: number;
    log: string[];
  };
} {
  const calls = {
    acquired: [] as string[],
    released: [] as string[],
    advanced: [] as string[],
    created: 0,
    log: [] as string[],
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
    output: {
      appendLine: (l: string) => calls.log.push(l),
    } as unknown as OrchestratorDeps["output"],
    canonicalRepo: "/repo",
    spawnWorker: () =>
      fakeWorker(
        opts.line ?? '{"type":"result","subtype":"success","is_error":false}\n',
      ),
    verify: async () => opts.verifyOk !== false,
    advance: async (handle: string) => {
      calls.advanced.push(handle);
    },
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
  assert.equal(r.verified, true);
  assert.equal(r.advanced, true); // worker success + verify green → advanced
  assert.deepEqual(calls.acquired, ["SP-1_SL-2"]);
  assert.deepEqual(calls.advanced, ["SP-1_SL-2"]);
  assert.deepEqual(calls.released, ["SP-1_SL-2"]); // released even on success
  assert.equal(calls.created, 1);
});

test("dispatchNext: worker success but verifier red → not advanced (still released)", async () => {
  const { deps, calls } = makeDeps(
    { "specs/SP-1/SL-1.md": { status: "ready" } },
    { verifyOk: false },
  );
  const r = await new OrchestratorService(deps).dispatchNext("1");
  assert.equal(r.success, true);
  assert.equal(r.verified, false);
  assert.equal(r.advanced, false);
  assert.deepEqual(calls.advanced, []); // gate refusal — no advance
  assert.deepEqual(calls.released, ["SP-1_SL-1"]);
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

test("dispatchFrontier: runs all footprint-disjoint ready slices and advances each", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] },
    "specs/SP-1/SL-2.md": { status: "ready", files: ["src/b.ts"] },
  });
  const rs = await new OrchestratorService(deps).dispatchFrontier("1", 4);
  assert.equal(rs.length, 2);
  assert.ok(rs.every((r) => r.advanced));
  assert.deepEqual(calls.advanced.sort(), ["SP-1_SL-1", "SP-1_SL-2"]);
});

test("dispatchFrontier: footprint-overlapping ready slices → only the first runs", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": { status: "ready", files: ["src/shared.ts"] },
    "specs/SP-1/SL-2.md": { status: "ready", files: ["src/shared.ts"] },
  });
  const rs = await new OrchestratorService(deps).dispatchFrontier("1", 4);
  assert.equal(rs.length, 1); // SL-2 deferred for footprint overlap
  assert.deepEqual(calls.advanced, ["SP-1_SL-1"]);
});

test("dispatchSlice: a slice's work units batch into execution units in one session (AC6)", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": {
      status: "ready",
      files: ["src/a.ts"],
      work_units: [
        { footprint: ["src/a.ts"], execution: "serial" },
        { footprint: ["src/b.ts"], execution: "serial" },
        { footprint: ["src/c.ts"], execution: "fan-out" },
      ],
    },
  });
  await new OrchestratorService(deps).dispatchFrontier("1", 4);
  const batchLine = calls.log.find((l) => l.includes("execution unit"));
  assert.ok(batchLine, "should log the execution-unit batch plan");
  assert.match(batchLine!, /3 work unit\(s\) → 2 execution unit\(s\)/);
});
