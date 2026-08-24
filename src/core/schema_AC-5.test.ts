/**
 * TRANSITION — the delivery page does not yet open with which run produced
 * it. This proves renderDeliveryPage puts the delivery's run id and its
 * produced-at time in the page's opening lines, before any section heading
 * — a reader must see who produced the report before reading what it says.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace } from "./schema";
import type { Delivery } from "./schema";

test("renderDeliveryPage opens with the run id and produced-at time, before any section heading", () => {
  const space = emptySpace();
  const delivery = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [],
    runId: "TEP-1@abc123",
    producedAt: "2026-08-24T10:00:00.000Z",
  } as unknown as Delivery;

  const page = renderDeliveryPage(space, delivery);
  const lines = page.split("\n");
  const firstHeading = lines.findIndex((l) => l.trim().startsWith("##"));
  const runIdLine = lines.findIndex((l) => l.includes("TEP-1@abc123"));
  const producedAtLine = lines.findIndex((l) => l.includes("2026-08-24T10:00:00.000Z"));

  assert.ok(runIdLine >= 0, "the run id appears on the page");
  assert.ok(producedAtLine >= 0, "the produced-at time appears on the page");
  assert.ok(
    firstHeading === -1 || (runIdLine < firstHeading && producedAtLine < firstHeading),
    "both appear before any section heading (## ...)",
  );
});

test("two deliveries of the same cut and branch differing only in run render pages whose opening lines differ", () => {
  const space = emptySpace();
  const base = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [],
  };
  const first = {
    ...base,
    runId: "TEP-1@run-one",
    producedAt: "2026-08-24T10:00:00.000Z",
  } as unknown as Delivery;
  const second = {
    ...base,
    runId: "TEP-1@run-two",
    producedAt: "2026-08-24T15:30:00.000Z",
  } as unknown as Delivery;

  const pageOne = renderDeliveryPage(space, first);
  const pageTwo = renderDeliveryPage(space, second);

  // The identity line is what tells the two reports apart. Same cut, same
  // branch, same proofs — only the run differs, and the opening must say so.
  const openingOf = (page: string): string =>
    page
      .split("\n")
      .slice(0, 2)
      .join("\n");

  assert.notEqual(
    openingOf(pageOne),
    openingOf(pageTwo),
    "the opening lines of the two pages are identical — the run is not named",
  );
  assert.ok(openingOf(pageOne).includes("TEP-1@run-one"), "the first page names its own run");
  assert.ok(openingOf(pageOne).includes("2026-08-24T10:00:00.000Z"), "and its own moment");
  assert.ok(openingOf(pageTwo).includes("TEP-1@run-two"), "the second page names its own run");
  assert.ok(openingOf(pageTwo).includes("2026-08-24T15:30:00.000Z"), "and its own moment");
  assert.ok(
    !openingOf(pageTwo).includes("TEP-1@run-one"),
    "the second page's opening still carries the first run's id",
  );
});
