/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Asking the platform again reaches a template's latest accepted delivery,
 * whether or not a proof waits on its deploy. A delivery whose deploy broke
 * and that carried no proof settled after the merge was cleared and never
 * deployed again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { templateDeliveryToSettle } from "./runGate";
import type { Delivery } from "../core/schema";

const d = (id: string, o: Partial<Delivery> = {}): Delivery =>
  ({ id, cutId: `cut-${id}`, proofs: [], acceptedAt: "2026-10-15T10:00:00Z", ...o }) as Delivery;

test("the latest accepted delivery with no answer is deployed, with or without a proof waiting on it", () => {
  assert.equal(templateDeliveryToSettle([d("1", { afterMerge: { at: "t", outcome: "held", said: "x" } }), d("2")])?.id, "2");
});

test("a latest delivery that already has an answer is not deployed again", () => {
  assert.equal(templateDeliveryToSettle([d("1"), d("2", { afterMerge: { at: "t", outcome: "held", said: "x" } })]), undefined);
});

test("a delivery not yet accepted, or rejected, is not what the deploy answers for", () => {
  assert.equal(templateDeliveryToSettle([d("1"), d("2", { acceptedAt: undefined })])?.id, "1");
  assert.equal(templateDeliveryToSettle([d("1", { rejectedAt: "t" })]), undefined);
});
