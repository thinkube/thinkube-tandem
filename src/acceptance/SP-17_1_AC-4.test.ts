// SP-17/1 AC4 — the extension type-checks under tsconfig.test.json and the whole suite stays green
// with the decoupled model in place.
//
// WHY (one-time TRANSITION — its job is done once the decoupled-model change ships): AC4 proves the
// change LANDED coherently — `npx tsc -p tsconfig.test.json && node --test out-test/` exits 0 — so
// the new pure resolver, the required `model` threaded as `options.model` at every seam, and every
// updated caller introduce no regression. The mere fact that THIS file compiles (it constructs
// `createSdkWorker`/`createSdkAssessor`/`createSdkJudge`/`createSdkAuditRunner` with the now-REQUIRED
// `model`, and feeds it from `resolveWorkerModel`) is itself the type-check evidence: omit the model
// anywhere and tsc fails loudly, which is the guarantee. Below we also exercise the whole
// resolver→seam composition per role to prove it runs green end to end. Once the transition ships and
// the suite is green, this probe's work is complete.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSdkWorker,
  createSdkAssessor,
  createSdkJudge,
} from "../services/OrchestratorService";
import { createSdkAuditRunner } from "../services/auditorRunner";
import { resolveWorkerModel } from "../services/workerModel";

/** A capturing fake SDK `query`: records the `options`, yields one successful `result`. */
function capturingQuery(
  captured: { options?: Record<string, unknown> },
  result: string,
) {
  return (args: { prompt: unknown; options: Record<string, unknown> }) => {
    captured.options = args.options;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result,
        session_id: "sess-ac4",
      };
    })();
  };
}

test("AC4: the model resolved per role threads end-to-end into every worker seam's options.model", async () => {
  // One operator config: base 'sonnet', with the judge role RAISED to 'opus'. The orchestrator
  // resolves per role at the deps boundary and passes the result as each seam's required `model`.
  const config = {
    workerModel: "sonnet",
    workerModelByRole: { judge: "opus" },
  };

  // ── code/test-author worker — role "code" resolves to the base 'sonnet' ──
  const workerCaptured: { options?: Record<string, unknown> } = {};
  const runWorker = createSdkWorker({
    cwd: "/wt",
    model: resolveWorkerModel(config, "code"),
    loadQuery: async () => capturingQuery(workerCaptured, "done") as never,
  });
  const prompt = (async function* () {
    yield { type: "user", message: { role: "user", content: "work" } };
  })();
  for await (const _ of runWorker(prompt)) {
    /* drive the lazy stream so query() fires */
  }
  assert.equal(
    workerCaptured.options?.model,
    "sonnet",
    "worker gets the base model",
  );

  // ── assessor — role "assessor" has no override, resolves to the base 'sonnet' ──
  const assessCaptured: { options?: Record<string, unknown> } = {};
  const assess = createSdkAssessor({
    cwd: "/wt",
    model: resolveWorkerModel(config, "assessor"),
    loadQuery: async () =>
      capturingQuery(
        assessCaptured,
        '{"pass": true, "rationale": "ok"}',
      ) as never,
  });
  await assess({ ac: 1, run: "", env: "assessment" }, "intent", "artifact");
  assert.equal(
    assessCaptured.options?.model,
    "sonnet",
    "assessor gets the base model",
  );

  // ── judge — role "judge" IS overridden, resolves to 'opus' ──
  const judgeCaptured: { options?: Record<string, unknown> } = {};
  const judge = createSdkJudge({
    cwd: "/wt",
    model: resolveWorkerModel(config, "judge"),
    loadQuery: async () =>
      capturingQuery(
        judgeCaptured,
        '{"fault": "code", "rationale": "x"}',
      ) as never,
  });
  await judge(
    { id: "SP-1_SL-1#eu-0", slice: "SP-1_SL-1", role: "code" },
    "red",
  );
  assert.equal(
    judgeCaptured.options?.model,
    "opus",
    "the judge role is raised to opus",
  );

  // ── acceptance-auditor — resolves the base (no role) to 'sonnet' ──
  const auditCaptured: { options?: Record<string, unknown> } = {};
  const runner = createSdkAuditRunner({
    model: resolveWorkerModel(config),
    loadQuery: async () =>
      capturingQuery(
        auditCaptured,
        '[{"ordinal":1,"verdict":"verifiable","run":"npm test","env":"local"}]',
      ) as never,
  });
  await runner({ acs: [{ ordinal: 1, text: "AC one" }], cwd: "/repo" });
  assert.equal(
    auditCaptured.options?.model,
    "sonnet",
    "auditor gets the base model",
  );
});
