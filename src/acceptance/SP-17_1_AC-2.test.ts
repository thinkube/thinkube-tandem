// SP-17/1 AC2 — every orchestrated worker query PINS `options.model` from its injected dependency.
//
// WHY (INVARIANT — must always hold, lives forever): a worker query that OMITS `options.model`
// silently inherits the session/environment default (`ANTHROPIC_MODEL`) — exactly the leak this spec
// closes. Each of the four Agent-SDK worker seams — the code/test-author worker (`createSdkWorker`),
// the assessor (`createSdkAssessor`), the judge (`createSdkJudge`) and the acceptance-auditor
// (`createSdkAuditRunner`) — must therefore pass an `options.model` EQUAL to the model supplied in its
// dependencies, and must never drop it. We wire each site's injectable `loadQuery`/query seam with a
// fake that records the `options` it was called with, and assert `options.model` is the injected
// sentinel. This must hold for the life of the code, so the probe lives permanently.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSdkWorker,
  createSdkAssessor,
  createSdkJudge,
} from "../services/OrchestratorService";
import { createSdkAuditRunner } from "../services/auditorRunner";

/** A capturing fake SDK `query`: records the `options` it is called with, then yields a single
 *  successful `result` (the shape each seam parses). The captured `options` is where `options.model`
 *  is inspected. */
function capturingQuery(
  captured: { options?: Record<string, unknown>; calls: number },
  result: string,
) {
  return (args: { prompt: unknown; options: Record<string, unknown> }) => {
    captured.calls++;
    captured.options = args.options;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result,
        session_id: "sess-model",
      };
    })();
  };
}

test("createSdkWorker pins options.model to deps.model — and does so LAZILY (only once the stream is driven)", async () => {
  const captured: { options?: Record<string, unknown>; calls: number } = {
    calls: 0,
  };
  const runWorker = createSdkWorker({
    cwd: "/wt",
    model: "worker-model-sentinel",
    loadQuery: async () => capturingQuery(captured, "done") as never,
  });

  // The prompt is a streaming-input async iterable (the worker's real prompt shape).
  const prompt = (async function* () {
    yield { type: "user", message: { role: "user", content: "do the work" } };
  })();

  // LAZY seam: `createSdkWorker(deps)(prompt)` must NOT call query() until the stream is consumed —
  // so the options (and the model capture) are still absent here. This is why the assertion below
  // MUST drive the stream first.
  const stream = runWorker(prompt);
  assert.equal(
    captured.calls,
    0,
    "query() is not called until the worker stream is iterated",
  );

  // Drive it once, per the contract, then assert on the captured options.
  for await (const _ of stream) {
    /* no-op — just pump the lazy stream so query() fires */
  }

  assert.equal(
    captured.calls,
    1,
    "the worker query fired exactly once when consumed",
  );
  assert.equal(
    captured.options?.model,
    "worker-model-sentinel",
    "the worker query pins options.model to deps.model — never omits it",
  );
  // The other options the worker always sets are present alongside the model.
  assert.equal(captured.options?.cwd, "/wt");
  assert.equal(captured.options?.permissionMode, "bypassPermissions");
});

test("createSdkAssessor pins options.model to deps.model on its query() call", async () => {
  const captured: { options?: Record<string, unknown>; calls: number } = {
    calls: 0,
  };
  const assess = createSdkAssessor({
    cwd: "/wt",
    model: "assessor-model-sentinel",
    loadQuery: async () =>
      capturingQuery(captured, '{"pass": true, "rationale": "ok"}') as never,
  });

  await assess(
    { ac: 1, run: "", env: "assessment" },
    "the AC intent",
    "the artifact",
  );

  assert.equal(captured.calls, 1);
  assert.equal(
    captured.options?.model,
    "assessor-model-sentinel",
    "the assessor query pins options.model to deps.model",
  );
});

test("createSdkJudge pins options.model to deps.model on its query() call", async () => {
  const captured: { options?: Record<string, unknown>; calls: number } = {
    calls: 0,
  };
  const judge = createSdkJudge({
    cwd: "/wt",
    model: "judge-model-sentinel",
    loadQuery: async () =>
      capturingQuery(
        captured,
        '{"fault": "code", "rationale": "diverged"}',
      ) as never,
  });

  await judge(
    { id: "SP-1_SL-1#eu-0", slice: "SP-1_SL-1", role: "code" },
    "the probe went red",
  );

  assert.equal(captured.calls, 1);
  assert.equal(
    captured.options?.model,
    "judge-model-sentinel",
    "the judge query pins options.model to deps.model",
  );
});

test("createSdkAuditRunner pins options.model to deps.model on its query() call", async () => {
  const captured: { options?: Record<string, unknown>; calls: number } = {
    calls: 0,
  };
  const runner = createSdkAuditRunner({
    model: "auditor-model-sentinel",
    loadQuery: async () =>
      capturingQuery(
        captured,
        '[{"ordinal":1,"verdict":"verifiable","run":"npm test","env":"local"}]',
      ) as never,
  });

  await runner({ acs: [{ ordinal: 1, text: "AC one" }], cwd: "/repo" });

  assert.equal(captured.calls, 1);
  assert.equal(
    captured.options?.model,
    "auditor-model-sentinel",
    "the acceptance-auditor query pins options.model to deps.model",
  );
});
