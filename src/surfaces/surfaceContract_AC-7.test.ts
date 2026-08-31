/**
 * INVARIANT — handleInbound must still refuse a governed action the phase
 * forbids, and the message it pushes must name the control by its
 * person-facing name — not a bare "not now" — so a press the surface let
 * through by mistake is answered by name and the action never runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleInbound, InboundAction } from "./inbound";
import { TandemSession } from "./session";
import { CONTROL_NAMES } from "./surfaceContract";

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-surfacecontract-ac7-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

test("handleInbound refuses a governed action forbidden by the phase, naming the control, and runs nothing", async () => {
  const session = throwawaySession();
  // running=true makes phaseOf(session) return "running", in which "build"
  // (a governed, shaping action) is forbidden by the phase table.
  session.running = true;

  let builtChangeIds: string[] | undefined;
  const originalBuild = session.build.bind(session);
  session.build = async (changeIds: string[]) => {
    builtChangeIds = changeIds;
    return originalBuild(changeIds);
  };

  const pushed: (string | undefined)[] = [];
  await handleInbound(session, { action: "build" } as InboundAction, (m) => pushed.push(m));

  assert.equal(builtChangeIds, undefined, "the forbidden action must not run");
  assert.equal(pushed.length, 1, "exactly one message is pushed for the refusal");
  const controlName = CONTROL_NAMES["build"];
  assert.ok(controlName, "the build action must have a control name");
  assert.ok(
    pushed[0] && pushed[0].includes(controlName),
    `the pushed message must name the control ("${controlName}"): got "${pushed[0]}"`,
  );
});
