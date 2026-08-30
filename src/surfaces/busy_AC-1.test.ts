/**
 * INVARIANT — the one busy line must name a running space and count its
 * units: busyLine, given one busy space whose worker units read one of
 * three done, returns a line that names that space and says "1/3" of its
 * units are done. A person glancing at the status bar must be able to tell
 * which space is busy and how far its build has gotten, from this one line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceBusy, busyLine } from "./busy";

test("busyLine names the running space and reports 1/3 units done", () => {
  const session = {
    running: true,
    runState: {
      view: () => ({
        units: [
          { id: "SL-1#eu-1", state: "done" },
          { id: "SL-1#eu-2", state: "running" },
          { id: "SL-1#eu-3", state: "running" },
        ],
        parked: [],
      }),
    },
  };

  const space = spaceBusy("owner/my-space", "My space", session);
  assert.ok(space, "a running session with units must be reported busy");

  const line = busyLine([space!], Date.now());
  assert.ok(line, "one busy space must produce a busy line");
  assert.ok(line!.text.includes("My space"), "the line must name the busy space");
  assert.ok(line!.text.includes("1/3"), "the line must say 1 of 3 units are done");
});
