/**
 * TRANSITION — doorsBySentence now takes the surface text it must check
 * doors against, instead of calling verifiedDoors() with nothing. A promise
 * whose matching door's handle is absent from that text must get no line at
 * all: printing a "see it" instruction for a door that cannot be shown to
 * exist is worse than printing nothing.
 *
 * This pins that a promise whose door handle is absent from the given
 * surface text gets no entry in the map doorsBySentence returns. Its job is
 * done once doorsBySentence reads surface text as its own argument.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { doorsBySentence } from "../gates/render";
import { Change } from "../core/schema";

function change(id: string, sentence: string): Change {
  return { id, sentence, serves: [], needs: [], acceptance: [] };
}

test("doorsBySentence returns no entry for a promise whose door handle is absent from the surface text", () => {
  const nodes = [change("n1", "the person can press build to start the run")];
  // "build" is a real action AFFORDANCES declares, but the surface text
  // carries neither its handle nor its page's handle.
  const surfaceText = "<div>nothing relevant here</div>";

  const experience = doorsBySentence(nodes, surfaceText);

  assert.ok(!experience.has("n1"), "no door is proved present, so no line is produced for this promise");
});
