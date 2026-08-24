/**
 * INVARIANT — the delivery report must always open by naming which run
 * produced it and when, before any section of the report (What is now
 * true, Checks, Not delivered, …). This must hold every time the page is
 * rendered for a delivery that carries a run identity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace, Delivery, Space } from "../core/schema";

function spaceWith(delivery: Delivery): Space {
  const s = emptySpace();
  return {
    ...s,
    cuts: [{ id: "cut-1", changeIds: [], tepId: "TEP-1" }],
    deliveries: [delivery],
  };
}

test("the opening lines of the delivery page name the run id and the produced-at moment, before any section", () => {
  const delivery: Delivery = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [{ kind: "suite", label: "repo suite", verdict: "green" }],
    ...( { runId: "TEP-1@abc123", producedAt: "2026-08-24T10:00:00.000Z" } as unknown as Partial<Delivery>),
  };
  const page = renderDeliveryPage(spaceWith(delivery), delivery);
  const lines = page.split("\n");
  // Find the first line that begins a titled section (## …) — everything
  // naming the run must appear strictly before it.
  const firstSectionIdx = lines.findIndex((l) => l.startsWith("## "));
  assert.ok(firstSectionIdx > 0, "the page has at least one section after its opening");
  const opening = lines.slice(0, firstSectionIdx).join("\n");
  assert.match(opening, /TEP-1@abc123/, "the opening names the run id");
  assert.match(opening, /2026-08-24T10:00:00\.000Z/, "the opening names the produced-at moment");
});
