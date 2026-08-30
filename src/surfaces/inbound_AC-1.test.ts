/**
 * TRANSITION — proves the documentation decision crosses the whole bridge:
 * the surface's WebToHost union carries the exemption action with its
 * reason text, post() sends that message, the host reads the reason from
 * the field the surface actually sent, and the verdict comes back on the
 * push as SpacePush.documentation — which the rail states rather than
 * deciding for itself.
 *
 * The bridge module is IMPORTED and driven, not read as text. A type that
 * is only declared vanishes at runtime, so the proof is that a real reason
 * put in at the surface end is the reason the host records.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleInbound, InboundAction } from "./inbound";
import { TandemSession } from "./session";
import { docsDuty } from "../core/docsDuty";
import { emptySpace } from "../core/schema";
import { refusedNow } from "./phase";
import { can, CONTROL_NAMES, noteAllowed, refusalSentence, WebToHost } from "./surfaceContract";

/** A session with one grounded promise and nothing signed — the phase in
 *  which the host offers the documentation exemption at all. */
function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-inbound-ac1-"));
  const session = new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
  session.space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "add a helper with no doc page",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "helper() runs" }],
        grounding: { touchpoints: [{ path: "src/helper.ts", planned: true }], stamp: [] },
      },
    ],
  } as never;
  return session;
}

test("the exemption reason the surface sends is the reason the host records", async () => {
  const session = throwawaySession();
  const reason = "this cut only moves a constant — no page describes it";

  // The message is typed by the union the surface really exports: if
  // WebToHost stopped carrying `reason`, this stops compiling.
  const msg: WebToHost = { action: "exempt-docs", reason };

  await handleInbound(session, msg as InboundAction, () => {});

  assert.equal(
    session.docsExemptionReason,
    reason,
    "the host read the reason from the field the surface sent, not a different one",
  );
});

test("a blank reason is refused, and nothing is recorded", async () => {
  const session = throwawaySession();

  await handleInbound(session, { action: "exempt-docs", reason: "   " } as InboundAction, () => {});

  assert.equal(session.docsExemptionReason, undefined, "a blank reason is not a reason");
});

test("the surface drops the exemption action in a phase the host would refuse", () => {
  // post() consults can() before sending. Assert the decision itself: the
  // action is sendable exactly when the host's allowed list names it, so a
  // control the phase forbids never reaches the host.
  noteAllowed(["exempt-docs", "build"]);
  assert.equal(can("exempt-docs"), true, "the host allows it now — post() would send it");

  noteAllowed(["build"]);
  assert.equal(can("exempt-docs"), false, "the host does not allow it now — post() drops it");

  // And the host refuses it on its side too, for the same phase, so a
  // press the surface let through by mistake still starts nothing.
  assert.ok(refusedNow("exempt-docs", "running"), "a run in flight refuses the exemption");
  assert.equal(refusedNow("exempt-docs", "understood"), undefined, "it is allowed once asks are understood");
});

test("handleInbound refuses a governed action the phase forbids, naming its control, and runs nothing", async () => {
  // This session is in the "understood" phase (nodes recorded, nothing
  // signed or running). "stop-run" is only allowed while a run is in
  // flight, so it is forbidden here — the host must answer with the same
  // sentence the surface itself would show, and must not call stopRun().
  const session = throwawaySession();
  let stopped = false;
  session.stopRun = () => {
    stopped = true;
    return 0;
  };

  const pushed: (string | undefined)[] = [];
  await handleInbound(session, { action: "stop-run" } as InboundAction, (m) => pushed.push(m));

  assert.deepEqual(pushed, [refusalSentence("stop-run", "understood")], "the host names the control and the phase's reason");
  assert.ok(pushed[0]?.includes(CONTROL_NAMES["stop-run"]), "the sentence names the control by its person-facing name");
  assert.equal(stopped, false, "the forbidden action never ran");
});

test("the documentation verdict on the push is the one rule's, for the cut being signed", () => {
  // The rail reads SpacePush.documentation and states it. The value is
  // docsDuty's, so a webview file never decides this for itself.
  const session = throwawaySession();
  const cut = { id: "pending", changeIds: [] as string[] };

  assert.deepEqual(
    docsDuty(session.space, cut),
    { state: "missing", landings: [] },
    "a cut that lands no docs and carries no exemption owes documentation",
  );

  const withReason = {
    ...cut,
    docsExemption: { reason: "no page describes a constant", at: "2026-01-01T00:00:00.000Z" },
  };
  const verdict = docsDuty(session.space, withReason);
  assert.equal(verdict.state, "exempt");
  assert.equal(verdict.reason, "no page describes a constant", "the recorded reason travels to the surface");
});
