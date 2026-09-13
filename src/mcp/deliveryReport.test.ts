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
