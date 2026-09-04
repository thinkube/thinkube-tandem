/**
 * One maintain unit per test file, never one per promise.
 *
 * A page's tests are brought under the promise that changes the page and
 * the promise that changes what it counts. Made per promise, two units
 * owned the same file, ran at the same time, and the second overwrote
 * what the first had just written — with the footprint guard content that
 * both, honestly, owned it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tepSlices } from "./adapter";
import { emptySpace, type Change, type Space } from "../core/schema";

function promise(id: string, sentence: string, lands: string[]): Change {
  return {
    id,
    sentence,
    serves: ["a1"],
    needs: [],
    acceptance: [{ id: `${id}-c1`, text: "it holds" }],
    grounding: { touchpoints: lands.map((path) => ({ path })), stamp: [] },
  } as never;
}

test("two promises whose tests live in one file share one maintainer, and it serves both", () => {
  const space: Space = {
    ...emptySpace(),
    asks: [{ id: "a1", text: "the page behaves" }] as never,
    nodes: [
      promise("n1", "finished tasks are out of the way", ["src/pages/HomePage.tsx", "src/pages/__tests__/HomePage.test.tsx"]),
      promise("n2", "the page states how many tasks there are", ["src/pages/HomePage.tsx", "src/pages/__tests__/HomePage.test.tsx"]),
      promise("n3", "an overdue task is marked", ["src/components/TaskCard.tsx", "src/components/__tests__/TaskCard.test.tsx"]),
    ],
  };
  const slices = tepSlices({ space, cut: { id: "cut-1", changeIds: ["n1", "n2", "n3"], askIds: ["a1"] } as never, spaceName: "test" });
  const maintainers = slices.filter((s) => (s as { maintains?: string[] }).maintains?.length);

  const homes = maintainers.flatMap((m) => m.files ?? []);
  assert.equal(new Set(homes).size, homes.length, `two units own one file: ${homes.join(", ")}`);
  assert.deepEqual(homes.sort(), ["src/components/__tests__/TaskCard.test.tsx", "src/pages/__tests__/HomePage.test.tsx"]);

  const shared = maintainers.find((m) => (m.files ?? []).includes("src/pages/__tests__/HomePage.test.tsx"))!;
  assert.equal((shared as { maintains?: string[] }).maintains!.length, 2, "it serves both promises whose tests live there");
  const note = (shared.workUnits[0] as { note?: string }).note ?? "";
  assert.match(note, /finished tasks are out of the way/);
  assert.match(note, /how many tasks there are/, "and says so in both their words");
  assert.doesNotMatch(shared.handle, /SL-\d+-tests$/, "a shared file's handle cannot be one promise's");
});
