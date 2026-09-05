import { test } from "node:test";
import assert from "node:assert/strict";
import { driveAll, driveOne, originOf } from "./drive";

/** One reply, in the shape the SDK streams it. */
function says(reply: string) {
  const seen: Record<string, unknown>[] = [];
  const ask = async (_p: string, options: Record<string, unknown>) => {
    seen.push(options);
    return {
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: reply };
      },
    } as AsyncIterable<unknown>;
  };
  return { ask, seen };
}

test("a driver is given a browser, one address, and no way to touch the repository", async () => {
  const { ask, seen } = says("1. GREEN typed a task, it appeared in the list");
  await driveOne(
    { at: "https://todo.example.com/app", model: "m", ask },
    { promise: "a task added is shown", criteria: [{ text: "the user adds a task and sees it in the list" }] },
    1,
  );
  const o = seen[0];
  const servers = o.mcpServers as Record<string, { args: string[] }>;
  assert.ok(servers.browser, "it gets a browser");
  assert.ok(
    servers.browser.args.includes("https://todo.example.com"),
    `and only that origin: ${servers.browser.args.join(" ")}`,
  );
  assert.deepEqual(o.additionalDirectories, [], "no repository is opened to it");
  for (const forbidden of ["Read", "Write", "Edit", "Bash", "WebFetch"])
    assert.ok((o.disallowedTools as string[]).includes(forbidden), `${forbidden} is refused`);
});

test("one session answers every criterion of its promise, each in its own words", async () => {
  const { ask } = says(
    "I opened the page.\n1. GREEN the list showed the soonest first\n2. RED the Add button does nothing — no task appears",
  );
  const ps = await driveOne(
    { at: "https://x.test", model: "m", ask },
    {
      promise: "a task added is shown",
      criteria: [
        { id: "AC-1", text: "the list is in due-date order" },
        { id: "AC-2", text: "adding a task shows it" },
      ],
    },
    1,
  );
  assert.deepEqual(ps.map((p) => p.verdict), ["green", "red"], "a verdict per criterion, from one browser");
  assert.deepEqual(ps.map((p) => p.criterionId), ["AC-1", "AC-2"]);
  assert.equal(ps[1].ref, "https://x.test", "the proof says where to go and look");
  assert.match(ps[1].label, /the Add button does nothing/);
});

test("a driver that never answers leaves the promise unjudged — never a pass nobody saw", async () => {
  const { ask } = says("I could not reach the page.");
  const ps = await driveOne(
    { at: "https://x.test", model: "m", ask },
    { promise: "p", criteria: [{ text: "c" }] },
    1,
  );
  assert.deepEqual(ps.map((p) => p.verdict), ["unjudged"]);
});

test("every promise is judged, and the verdicts come back grouped as they were asked", async () => {
  const replies = ["1. GREEN one", "1. RED two", "1. GREEN three"];
  let i = 0;
  const ask = async () =>
    ({
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: replies[i++] };
      },
    }) as AsyncIterable<unknown>;
  const proofs = await driveAll({ at: "https://x.test", model: "m", ask }, [
    { promise: "p1", criteria: [{ text: "c1" }] },
    { promise: "p2", criteria: [{ text: "c2" }] },
    { promise: "p3", criteria: [{ text: "c3" }] },
  ]);
  assert.equal(proofs.length, 3, "one list per promise");
  assert.deepEqual(
    proofs.flat().map((p) => p.verdict).sort(),
    ["green", "green", "red"],
    "each one carries its own verdict",
  );
});

test("the address the browser is held to is the origin, whatever path the product is at", () => {
  assert.equal(originOf("https://todo.example.com/app/deep?x=1"), "https://todo.example.com");
  assert.equal(originOf("not a url"), "not a url");
});
