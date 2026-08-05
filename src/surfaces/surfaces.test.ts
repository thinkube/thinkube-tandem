/**
 * Reachability: every session action has a registered human door or a
 * declared machine-only reason — and the session round-trips a space
 * through capture, cut, sign, and acceptance with an injected round.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { AFFORDANCES, gestureFor } from "./affordances";
import { SESSION_ACTIONS, TandemSession } from "./session";

test("no capability without a door: every session action is registered", () => {
  for (const action of SESSION_ACTIONS) {
    const entry = AFFORDANCES[action];
    assert.ok(entry, `action '${action}' has no affordance entry`);
    if (entry.kind === "human") {
      assert.ok(entry.affordance.surface.trim());
      assert.ok(entry.affordance.gesture.trim());
    } else {
      assert.ok(entry.reason.trim(), `machine-only '${action}' must state why`);
    }
  }
  assert.ok(gestureFor("sign-cut")!.includes("press Sign"));
  assert.ok(gestureFor("reground")!.includes("stale badge"), "re-grounding has a human door");
});

test("session round-trip: capture grounds and clusters; sign; accept only on green; persistence keeps both", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    now: () => "2026-08-05T19:00:00Z",
    readCurrentStamp: async () => [],
    ground: async (_d: unknown, ask: { id: string }, opts: { nextIndex: number }) => [
      {
        id: `node-${opts.nextIndex}`,
        sentence: "the toolbar gains a capture box",
        serves: [ask.id],
        needs: [],
        acceptance: [{ id: "c1", text: "box visible" }],
        grounding: { touchpoints: [{ path: "src/toolbar.ts" }], stamp: [] },
      },
    ],
  };
  const session = new TandemSession(deps as never);
  const captured = await session.capture("I want to capture asks from the toolbar");
  assert.ok(captured.ok);
  assert.equal(session.space.asks[0].text, "I want to capture asks from the toolbar");
  assert.equal(session.units.length, 1, "grounded node clustered into a unit");

  session.toggleCut(session.units[0].changeIds);
  assert.ok(session.cutScreen().includes("1 change(s)"));
  assert.ok(session.signCut().ok, "signing succeeds; with no forge the run stays parked");
  assert.equal(session.space.cuts.length, 1);
  assert.ok(session.space.cuts[0].signature, "signature bound at the click");
  const tepId = session.space.cuts[0].tepId!;
  assert.match(tepId, /^TEP-user-1$/);
  assert.equal(session.tepApproval(tepId).approved, true, "the click minted a real content-bound token");
  session.space = {
    ...session.space,
    nodes: session.space.nodes.map((n) => ({ ...n, sentence: n.sentence + " (edited)" })),
  };
  const stale = session.tepApproval(tepId);
  assert.equal(stale.approved, false, "editing the signed content re-arms the gate");
  assert.equal(stale.reason, "content-mismatch");

  session.space = {
    ...session.space,
    deliveries: [
      { id: "d-1", cutId: "cut-1", branch: "tandem/cut-1", proofs: [{ kind: "suite", label: "suite", verdict: "pending" }] },
    ],
  };
  assert.equal((await session.acceptDelivery("d-1")).ok, false, "pending proof blocks");
  session.space.deliveries[0].proofs[0].verdict = "green";
  assert.ok((await session.acceptDelivery("d-1")).ok);

  const reloaded = new TandemSession(deps as never);
  assert.equal(reloaded.space.asks.length, 1, "the space survives a reload");
  assert.equal(reloaded.space.deliveries[0].acceptedAt, "2026-08-05T19:00:00Z");
});
