/**
 * TRANSITION — the delivery page opens with the run that produced it. A
 * delivery from before run stamping carries neither a run id nor a
 * produced-at, and interpolating them regardless printed an identity line
 * reading "Run `undefined` produced this delivery at undefined." — the
 * machine's own missing field shown to a person as if it were a fact. This
 * proves such a delivery is named as an unknown run, with no empty and no
 * "undefined" identity line anywhere on the page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace } from "./schema";
import type { Delivery, Space } from "./schema";

test("a delivery with no run id and no produced-at renders an unknown run, never 'undefined'", () => {
  const space: Space = emptySpace();
  space.cuts.push({ id: "cut-15", changeIds: [] });
  const delivery: Delivery = {
    id: "delivery-TEP-15",
    cutId: "cut-15",
    branch: "tandem/TEP-15",
    proofs: [],
  };

  const page = renderDeliveryPage(space, delivery);

  assert.ok(
    !/undefined/i.test(page),
    `the page prints the machine's missing field to the person:\n${page}`,
  );
  assert.ok(!/\bnull\b/i.test(page), `the page prints a null:\n${page}`);

  const lines = page.split("\n");
  const heading = lines.findIndex((l) => l.startsWith("# Delivery"));
  assert.ok(heading >= 0, "the page opens with the delivery heading");

  // The identity line sits directly under the heading, before any section,
  // and says something — an empty line there is the same silence.
  const identity = lines[heading + 1];
  assert.ok(identity !== undefined, "an identity line follows the heading");
  assert.ok(identity.trim().length > 0, "the identity line is not empty");
  assert.ok(
    !identity.startsWith("#"),
    `a section heading arrived where the run identity belongs: "${identity}"`,
  );

  // It names the run as unknown rather than asserting one.
  assert.ok(
    /not recorded|unknown|predates/i.test(identity),
    `the identity line does not name the run as unknown: "${identity}"`,
  );
  assert.ok(
    !/^Run\s+``/.test(identity) && !/Run\s+`\s*`/.test(identity),
    `the identity line claims an empty run id: "${identity}"`,
  );
});
