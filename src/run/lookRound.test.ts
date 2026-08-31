/**
 * The look runs once per ask, and what it finds arrives knowing where it belongs.
 *
 * The complaint that started this was not "a check failed". It was seeing the
 * delivered thing, wanting it fixed, and facing four hours of writing asks
 * again — because a finding about a surface has no way back to the sentence
 * that asked for it. Driving the deployed thing one ask at a time is what
 * gives a finding its address for free.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asFindings, asksOfDelivery, lookAfterDeploy } from "./lookRound";

const SPACE = {
  asks: [
    { id: "a1", text: "the asks section is tall enough to read", at: "" },
    { id: "a2", text: "cards say which promise they keep", at: "" },
    { id: "a3", text: "something nobody cut", at: "" },
  ],
  nodes: [
    { id: "n1", serves: ["a1"], needs: [], sentence: "the list has room" },
    { id: "n2", serves: ["a2"], needs: [], sentence: "cards are labelled" },
    { id: "n3", serves: ["a3"], needs: [], sentence: "not in the cut" },
  ],
  cuts: [{ id: "cut-1", changeIds: ["n1", "n2"] }],
} as never;
const DELIVERY = { cutId: "cut-1" };
const DEPS = { repoRoot: "/x", model: "sonnet" } as never;

test("a delivery's asks are the person's own sentences, through the space's own edges", () => {
  assert.deepEqual(asksOfDelivery(SPACE, DELIVERY), [
    { id: "a1", text: "the asks section is tall enough to read" },
    { id: "a2", text: "cards say which promise they keep" },
  ]);
});

test("an ask nobody cut is not looked at", () => {
  const asks = asksOfDelivery(SPACE, DELIVERY);
  assert.ok(!asks.some((a) => a.id === "a3"), "the look answers for what was delivered, not for the space");
});

test("every ask of the delivery is driven, and each finding names its own ask", async () => {
  const seen: string[] = [];
  const found = await lookAfterDeploy({
    url: "https://todo.example",
    space: SPACE,
    delivery: DELIVERY,
    deps: DEPS,
    look: (async (a: { ask: string; url: string }) => {
      seen.push(a.ask);
      return {
        looked: true,
        findings: [{ said: `wrong about ${a.ask}`, where: `${a.url} · ${a.ask}` }],
      };
    }) as never,
  });
  assert.equal(seen.length, 2, "one worker per ask");
  assert.deepEqual(asFindings(found), [
    "the asks section is tall enough to read: wrong about the asks section is tall enough to read",
    "cards say which promise they keep: wrong about cards say which promise they keep",
  ]);
});

test("a worker that throws costs the run nothing", async () => {
  const found = await lookAfterDeploy({
    url: "https://todo.example",
    space: SPACE,
    delivery: DELIVERY,
    deps: DEPS,
    look: (async (a: { ask: string }) => {
      if (a.ask.startsWith("the asks")) throw new Error("chromium died");
      return { looked: true, findings: [{ said: "still said", where: "u · " + a.ask }] };
    }) as never,
  });
  assert.deepEqual(asFindings(found), ["cards say which promise they keep: still said"],
    "one broken look does not silence the others, and is not itself a finding");
});

test("nothing found is the normal ending", async () => {
  const found = await lookAfterDeploy({
    url: "https://todo.example", space: SPACE, delivery: DELIVERY, deps: DEPS,
    look: (async () => ({ looked: true, findings: [] })) as never,
  });
  assert.deepEqual(found, []);
});
