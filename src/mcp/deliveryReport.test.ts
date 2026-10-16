/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** A delivery's findings are read in their own words, never as [object Object]. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolTable } from "./tools";

test("read_delivery renders each finding's words and what it was about", () => {
  const tool = toolTable().find((t) => t.name === "read_delivery")!;
  const session = {
    space: {
      deliveries: [
        { cutId: "cut-1", proofs: [{ verdict: "green", label: "review-1" }], findings: [{ saw: "the page is blank", ask: "the list" }, { saw: "nothing can be pressed" }] },
      ],
    },
  };
  const text = tool.run({ session, project: {}, storeDir: "", args: {} } as never) as string;
  assert.ok(!text.includes("[object Object]"), text);
  assert.match(text, /· the page is blank \(about: the list\)/);
  assert.match(text, /· nothing can be pressed/);
});

test("read_delivery shows a live check's proof with the check's path, its output kept under it", () => {
  const tool = toolTable().find((t) => t.name === "read_delivery")!;
  const session = {
    space: {
      deliveries: [
        {
          cutId: "cut-1",
          proofs: [
            {
              verdict: "red",
              label: "the storage service returns the document's XLIFF for a key",
              criterionId: "n1-check-2",
              ref: "live check live/storage_AC-2_test.py: exit 1 — E   KeyError: 'xliff'\n1 failed in 0.3s",
            },
          ],
        },
      ],
    },
  };
  const text = tool.run({ session, project: {}, storeDir: "", args: {} } as never) as string;
  assert.match(text, /red {4}\[n1-check-2\] the storage service returns the document's XLIFF for a key — live check live\/storage_AC-2_test\.py: exit 1/);
  assert.match(text, /\n {9}1 failed in 0\.3s/);
});
