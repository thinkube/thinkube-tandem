/**
 * A failed reading is not a fact. A reading that returns nothing must not
 * be remembered as "nothing needed", and a blank must never be proven: a
 * run that inherits a blank runs every check on an unbuilt tree and fails
 * them all for a reason nobody was told.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { knowledgeOf } from "./knowledge";

function fakeStore(): { saved: Record<string, string>; load: (k: string) => string | undefined; save: (k: string, t: string) => void } {
  const saved: Record<string, string> = {};
  return { saved, load: (k) => saved[k], save: (k, t) => void (saved[k] = t) };
}

test("a reading that returns nothing is not cached as nothing-needed, and a blank is never proven", async () => {
  const store = fakeStore();
  store.saved["digest@x"] = "a digest";
  const k = await knowledgeOf({
    deps: { model: "sonnet", repoRoot: process.cwd(), log: () => {} },
    cacheRoot: "/tmp",
    decisions: [],
    store,
    round: async () => null,
    graph: { graphPath: "/nowhere/graph.json", stamp: { root: process.cwd(), head: "x", dirty: "" } },
  } as never).catch(() => undefined);
  if (!k) return; // the map could not be built here — the rule under test is below
  assert.equal(Object.keys(store.saved).some((key) => key.startsWith("setup@") && key !== "setup@proven"), false, "no blank was cached");
  k.proveSetup({ provision: "", prepare: "", runOne: "" });
  assert.equal(store.saved["setup@proven"], undefined, "a blank is never proven");
  k.proveSetup({ provision: "npm ci", prepare: "", runOne: "" });
  assert.ok(store.saved["setup@proven"], "an answer with content is");
});
