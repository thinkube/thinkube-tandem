/**
 * A discovery waits its turn.
 *
 * Findings arrive while the goals a person started with are still being
 * built. Taking one made it an ask straight away, which put it in front
 * of the work they chose first and read every sentence again to do it —
 * and a finding not taken there and then went off screen with its report.
 * So a finding is kept instead: wanted, not now, and still there when the
 * person decides the discoveries are what comes next.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import { handleInbound } from "./inbound";
import { emptySpace } from "../core/schema";

function sessionWithFindings(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-kept-"));
  const session = new TandemSession({
    author: "cmxela",
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
  session.space = {
    ...emptySpace(),
    draft: "",
    cuts: [
      { id: "cut-1", tepId: "TEP-1", changeIds: [] },
      { id: "cut-2", tepId: "TEP-2", changeIds: [] },
    ],
    deliveries: [
      {
        id: "d-1",
        cutId: "cut-1",
        branch: "b1",
        proofs: [],
        findings: [
          { saw: "the accents are stripped", ask: "Show the accents properly" },
          { saw: "no way to tick a task off", ask: "Let me tick a task off from the card" },
        ],
      },
      {
        id: "d-2",
        cutId: "cut-2",
        branch: "b2",
        proofs: [],
        findings: [{ saw: "the tab title is a placeholder", ask: "Name the tab after the app" }],
      },
    ],
  } as never;
  return session;
}

test("keeping a finding makes no ask and touches nothing that is being built", async () => {
  const session = sessionWithFindings();
  await handleInbound(
    session,
    { action: "keep-findings", deliveryId: "d-1", items: ["the accents are stripped"] } as never,
    () => {},
  );
  assert.equal(session.space.draft, "", "nothing lands in the capture box");
  assert.deepEqual(session.space.deliveries[0].findingsKept, ["the accents are stripped"]);
  assert.equal(session.space.deliveries[0].findingsAsked, undefined, "and it is not an ask yet");
  assert.equal(session.space.asks.length, 0, "so the sentences are not read again");
});

test("what is kept stays visible whichever cut delivered it", async () => {
  const session = sessionWithFindings();
  await handleInbound(session, { action: "keep-findings", deliveryId: "d-1", items: ["the accents are stripped"] } as never, () => {});
  await handleInbound(session, { action: "keep-findings", deliveryId: "d-2", items: ["the tab title is a placeholder"] } as never, () => {});
  const push = spacePush(session) as { deliveries: { findings?: { text: string; kept?: boolean }[] }[] };
  const kept = push.deliveries.flatMap((d) => (d.findings ?? []).filter((f) => f.kept).map((f) => f.text));
  assert.deepEqual(kept, ["the accents are stripped", "the tab title is a placeholder"], "an older cut's kept finding is still offered");
});

test("when the person says so, every kept finding becomes an ask at once", async () => {
  const session = sessionWithFindings();
  await handleInbound(session, { action: "keep-findings", deliveryId: "d-1", items: ["the accents are stripped"] } as never, () => {});
  await handleInbound(session, { action: "keep-findings", deliveryId: "d-2", items: ["the tab title is a placeholder"] } as never, () => {});
  await handleInbound(session, { action: "ask-from-kept" } as never, () => {});
  assert.equal(
    session.space.draft,
    "Show the accents properly\nName the tab after the app",
    "the drafted asks, in the capture box, in the order they were noticed",
  );
  assert.deepEqual(session.space.deliveries[0].findingsAsked, ["the accents are stripped"]);
  assert.deepEqual(session.space.deliveries[1].findingsAsked, ["the tab title is a placeholder"]);
});

test("a finding is never kept twice, and never doubled in the box", async () => {
  const session = sessionWithFindings();
  const items = ["the accents are stripped"];
  await handleInbound(session, { action: "keep-findings", deliveryId: "d-1", items } as never, () => {});
  await handleInbound(session, { action: "keep-findings", deliveryId: "d-1", items } as never, () => {});
  assert.deepEqual(session.space.deliveries[0].findingsKept, items, "keeping it again changes nothing");
  await handleInbound(session, { action: "ask-from-kept" } as never, () => {});
  await handleInbound(session, { action: "ask-from-kept" } as never, () => {});
  assert.equal(session.space.draft, "Show the accents properly", "and it reaches the box once");
});
