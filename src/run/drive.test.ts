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
  const { ask, seen } = says("GREEN typed a task, it appeared in the list");
  await driveOne(
    { at: "https://todo.example.com/app", model: "m", ask },
    { promise: "a task added is shown", criterion: "the user adds a task and sees it in the list" },
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

test("the driver's word is the verdict, and its line is the reason", async () => {
  const { ask } = says("I opened the page.\nRED the Add button does nothing — no task appears");
  const p = await driveOne(
    { at: "https://x.test", model: "m", ask },
    { promise: "a task added is shown", criterion: "adding a task shows it", criterionId: "AC-1" },
    1,
  );
  assert.equal(p.verdict, "red");
  assert.equal(p.criterionId, "AC-1");
  assert.equal(p.ref, "https://x.test", "the proof says where to go and look");
  assert.match(p.label, /the Add button does nothing/);
});

test("a driver that never answers leaves the promise unjudged — never a pass nobody saw", async () => {
  const { ask } = says("I could not reach the page.");
  const p = await driveOne(
    { at: "https://x.test", model: "m", ask },
    { promise: "p", criterion: "c" },
    1,
  );
  assert.equal(p.verdict, "unjudged");
});

test("every criterion is judged, and each proof answers its own criterion", async () => {
  const replies = ["GREEN one", "RED two", "GREEN three"];
  let i = 0;
  const ask = async () =>
    ({
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: replies[i++] };
      },
    }) as AsyncIterable<unknown>;
  const proofs = await driveAll({ at: "https://x.test", model: "m", ask }, [
    { promise: "p1", criterion: "c1" },
    { promise: "p2", criterion: "c2" },
    { promise: "p3", criterion: "c3" },
  ]);
  assert.equal(proofs.length, 3);
  assert.deepEqual(
    proofs.map((p) => p.verdict).sort(),
    ["green", "green", "red"],
    "each one carries its own verdict",
  );
});

test("the address the browser is held to is the origin, whatever path the product is at", () => {
  assert.equal(originOf("https://todo.example.com/app/deep?x=1"), "https://todo.example.com");
  assert.equal(originOf("not a url"), "not a url");
});
