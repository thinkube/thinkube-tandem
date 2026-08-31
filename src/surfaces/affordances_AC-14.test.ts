/**
 * TRANSITION — when a promise's door AND that door's page are both proved
 * present in the given surface text, doorsBySentence names the page's own
 * label and the door's gesture, so the walkthrough line points at
 * something a person can actually find on screen.
 *
 * This pins the positive case beside AC-13's negative one: given surface
 * text carrying both the page handle and the door handle, the returned line
 * names the page's label and the door's gesture. Its job is done once
 * doorsBySentence produces this line from real proof.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { doorsBySentence } from "../gates/render";
import { Change } from "../core/schema";
import { PAGES, AFFORDANCES } from "./affordances";

function change(id: string, sentence: string): Change {
  return { id, sentence, serves: [], needs: [], acceptance: [] };
}

test("doorsBySentence returns a line naming the page's label and the door's gesture when both are present", () => {
  const buildEntry = AFFORDANCES["build"];
  assert.equal(buildEntry.kind, "human", "set up: build is a human door");
  const affordance = (buildEntry as { affordance: { page: string; gesture: string } }).affordance;
  const pageEntry = PAGES[affordance.page];
  assert.ok(pageEntry, "set up: build's page is declared in PAGES");

  const nodes = [change("n1", "the person can press build to start the run")];
  const surfaceText = `<section ${pageEntry.handle}><button data-build>Build</button></section>`;

  const experience = doorsBySentence(nodes, surfaceText);

  const line = experience.get("n1");
  assert.ok(line, "a line was produced for a promise whose door and page are both proved");
  assert.ok(line!.includes(pageEntry.label), `line "${line}" names the page's label "${pageEntry.label}"`);
  assert.ok(line!.includes(affordance.gesture), `line "${line}" names the door's gesture "${affordance.gesture}"`);
});
