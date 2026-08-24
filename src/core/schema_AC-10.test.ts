/**
 * TRANSITION — dispatching a cut across scopes today calls dispatchTep once
 * per scope with no shared run identity, so sibling deliveries of one press
 * cannot be told apart from three unrelated runs. This proves dispatching a
 * cut that spans two scopes gives both scopes' dispatches the same run id,
 * and both deliveries carry that id and the same produced-at time — one
 * press names ONE run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchScopePlan } from "../dispatch/scopeRun";
import { RunState } from "../run/state";
import { emptySpace } from "../core/schema";
import type { Space, Delivery } from "../core/schema";
import type { DispatchDeps } from "../run/deps";
import type { DispatchOutcome } from "../run/dispatch";
import type { SessionDeps } from "../surfaces/sessionDeps";

test("a cut spanning two scopes gives both dispatches the same run id and produced-at time", async () => {
  const space: Space = emptySpace();
  const cut = { id: "cut-1", changeIds: [] };
  const seenRunIds: (string | undefined)[] = [];
  const deliveries: Delivery[] = [];

  const fakeDispatch = async (deps: DispatchDeps): Promise<DispatchOutcome> => {
    seenRunIds.push((deps as unknown as { runId?: string }).runId);
    const delivery = {
      id: `delivery-${deps.spaceName}`,
      cutId: cut.id,
      branch: "tandem/x",
      proofs: [],
      runId: (deps as unknown as { runId?: string }).runId,
      producedAt: (deps as unknown as { producedAt?: string }).producedAt,
    } as unknown as Delivery;
    deliveries.push(delivery);
    return { refusals: [], undelivered: [], delivery };
  };

  const plan = {
    ok: true as const,
    groups: new Map<string, string[]>([
      ["", []],
      ["other-scope", []],
    ]),
    order: ["", "other-scope"],
  };

  const deps: SessionDeps = {
    round: { repoRoot: "/anchor", model: "sonnet" } as never,
    storeDir: "/tmp/store",
    storageDir: "/tmp/storage",
    now: () => "2026-08-24T12:00:00.000Z",
    dispatch: fakeDispatch as never,
    resolveScope: async () => ({ gitRoot: "/other", prefix: "other" }),
  };

  await dispatchScopePlan({
    plan,
    cut: cut as never,
    space: () => space,
    deps,
    runState: new RunState(() => {}),
    spaceName: "cross-scope",
    onDelivery: () => {},
    changed: () => {},
  });

  assert.equal(seenRunIds.length, 2, "both scopes were dispatched");
  assert.ok(seenRunIds[0], "the first scope's dispatch received a run id");
  assert.equal(seenRunIds[0], seenRunIds[1], "both scopes' dispatches share the same run id");

  assert.equal(deliveries.length, 2, "both scopes produced a delivery");
  const runIds = deliveries.map((d) => (d as unknown as { runId?: string }).runId);
  const producedAts = deliveries.map((d) => (d as unknown as { producedAt?: string }).producedAt);
  assert.equal(runIds[0], runIds[1], "both deliveries carry the same run id");
  assert.ok(producedAts[0], "a produced-at time is present");
  assert.equal(producedAts[0], producedAts[1], "both deliveries carry the same produced-at time");
});
