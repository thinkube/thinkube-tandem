/**
 * The shape a contract fixes is shaped by what will judge it.
 *
 * A promise that introduces a function names it before it exists, so the
 * grounding invents its signature and writes it into the contract — the
 * tester writes checks to that shape and the coder builds to it, and one
 * shape is the point. The shape was invented from the promise's sentence
 * alone, while the criteria that would judge it sat unread on the same
 * node. So a criterion naming six distinct states was met by a type
 * holding five: the coder was bound to a contract no correct
 * implementation could satisfy, its check failed for a reason no code
 * could fix, and the impossibility arrived as an unkept promise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runGrounding } from "./ground";

const NODES = JSON.stringify({
  nodes: [
    {
      sentence: "a card's state gets a coloured frame that survives zooming out",
      touchpoints: [{ path: "src/cardFace.ts", symbol: "stateFace", evidence: "the rule lives inside the card today" }],
      acceptance: [
        { text: "stateFace gives each state — ready, running, parked, done, failed, blocked — its own tone" },
        { text: "stateFace returns a non-empty word for a state it does not recognise" },
      ],
    },
  ],
});

test("the signature is shaped with the criteria that will judge it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-shape-"));
  const prompts: string[] = [];

  await runGrounding(
    { repoRoot: dir, model: "sonnet" } as never,
    { id: "ask-1", text: "state should stay readable when I zoom out" } as never,
    { nextIndex: 1 },
    async (_deps, prompt) => {
      prompts.push(prompt);
      return prompts.length === 1 ? NODES : "1: stateFace(state: string): { word: string; tone: Tone }";
    },
  );

  const shaping = prompts[1];
  assert.ok(shaping, "a function named by a bare name is shaped before any worker starts");
  assert.match(
    shaping,
    /must satisfy: stateFace gives each state — ready, running, parked, done, failed, blocked — its own tone/,
    "the criterion that will judge this signature is in front of whoever shapes it",
  );
  assert.match(
    shaping,
    /must satisfy: stateFace returns a non-empty word/,
    "every criterion of the promise, not the first",
  );
  assert.match(
    shaping,
    /narrower than its criteria cannot\s+be met by any correct implementation/,
    "and what a shape too narrow for them costs is said plainly",
  );
});
