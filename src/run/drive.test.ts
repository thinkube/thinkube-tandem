import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { driveAll, driveOne, originOf } from "./drive";

/** One reply, in the shape the SDK streams it. */
function says(reply: string) {
  const seen: Record<string, unknown>[] = [];
  const asked: string[] = [];
  const ask = async (p: string, options: Record<string, unknown>) => {
    asked.push(p);
    seen.push(options);
    return {
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: reply };
      },
    } as AsyncIterable<unknown>;
  };
  return { ask, seen, asked };
}

test("a driver is given a browser, one address, and no way to touch the repository", async () => {
  const { ask, seen } = says("1. GREEN typed a task, it appeared in the list");
  await driveOne(
    { at: "https://todo.example.com/app", model: "m", ask, browserAt: "http://localhost:1/mcp" },
    { promise: "a task added is shown", criteria: [{ text: "the user adds a task and sees it in the list" }] },
    1,
  );
  const o = seen[0];
  assert.ok((o.mcpServers as Record<string, unknown>).browser, "it gets a browser");
  assert.deepEqual(o.additionalDirectories, [], "no repository is opened to it");
  for (const forbidden of ["Read", "Write", "Edit", "Bash", "WebFetch"])
    assert.ok((o.disallowedTools as string[]).includes(forbidden), `${forbidden} is refused`);
});

test("the one origin a reviewer's browser may open is the product's own", () => {
  // The limit lives with the server that enforces it, so it is proved
  // where it is set rather than through a reviewer's options.
  assert.equal(originOf("https://todo.example.com/app"), "https://todo.example.com");
});

test("one session answers every criterion of its promise, each in its own words", async () => {
  const { ask } = says(
    "I opened the page.\n1. GREEN the list showed the soonest first\n2. RED the Add button does nothing — no task appears",
  );
  const ps = await driveOne(
    { at: "https://x.test", model: "m", ask, browserAt: "http://localhost:1/mcp" },
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
  assert.equal(ps[1].label, "adding a task shows it", "the finding is named by what it judged");
  assert.match(ps[1].ref ?? "", /the Add button does nothing/, "and its reason is what the reviewer saw");
  assert.match(ps[1].ref ?? "", /https:\/\/x\.test/, "with where to go and look");
  assert.notEqual(ps[0].ref, ps[1].ref, "two findings never read as one");
});

test("a driver that never answers leaves the promise unjudged — never a pass nobody saw", async () => {
  const { ask } = says("I could not reach the page.");
  const ps = await driveOne(
    { at: "https://x.test", model: "m", ask, browserAt: "http://localhost:1/mcp" },
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

test("a reviewer that could not get in judges nothing — never a red the work did not earn", async () => {
  const { ask } = says("1. BLOCKED the address redirected to a sign-in page and no way in was offered");
  const ps = await driveOne(
    { at: "https://x.test", model: "m", ask, browserAt: "http://localhost:1/mcp" },
    { promise: "a task added is shown", criteria: [{ id: "AC-1", text: "adding a task shows it" }] },
    1,
  );
  assert.deepEqual(ps.map((p) => p.verdict), ["unjudged"]);
  assert.match(ps[0].ref ?? "", /nothing was judged/);
  assert.match(ps[0].ref ?? "", /sign-in page/, "in the reviewer's own words");
});

test("a reviewer is connected to a browser that is already up", async () => {
  const { ask, seen } = says("1. GREEN it was there");
  await driveOne(
    { at: "https://x.test", model: "m", ask, browserAt: "http://localhost:39217/mcp" },
    { promise: "p", criteria: [{ text: "c" }] },
    1,
  );
  const servers = seen[0].mcpServers as Record<string, { type: string; url: string }>;
  assert.deepEqual(
    servers.browser,
    { type: "http", url: "http://localhost:39217/mcp" },
    "an address, not a command to spawn — there is no window with no browser in it",
  );
});

test("a reviewer gets the browser it was given and no other", async () => {
  const { ask, seen } = says("1. GREEN it was there");
  await driveOne(
    { at: "https://x.test", model: "m", ask, browserAt: "http://localhost:1/mcp" },
    { promise: "p", criteria: [{ text: "c" }] },
    1,
  );
  const o = seen[0];
  assert.equal(o.strictMcpConfig, true, "the machine's own browser server is not inherited");
  assert.ok((o.disallowedTools as string[]).includes("mcp__playwright"), "and is refused by name as well");
  assert.deepEqual(Object.keys(o.mcpServers as object), ["browser"]);
});

test("the browser server and the chrome are the ones this machine has", async () => {
  const { ask, seen } = says("1. GREEN it was there");
  await driveOne({ at: "https://x.test", model: "m", ask, browserAt: "http://localhost:1/mcp" }, { promise: "p", criteria: [{ text: "c" }] }, 1);
  const b = (seen[0].mcpServers as Record<string, { command: string; args: string[] }>).browser;
  const fetched = b.command === "npx";
  assert.equal(
    fetched,
    !fs.existsSync(path.join(process.env.HOME ?? "~", ".npm-global", "bin", "playwright-mcp")),
    "it fetches a server only where the machine has none",
  );
});

test("a reviewer still working is asked to carry on, and stops when a round adds nothing", async () => {
  // Two criteria; the first round answers one and keeps working, the
  // second answers the rest.
  const replies = [
    "1. GREEN the cursor was in the title",
    "1. GREEN the cursor was in the title\n2. RED Enter did not save",
  ];
  let i = 0;
  const seen: Record<string, unknown>[] = [];
  const ask = async (_p: string, options: Record<string, unknown>) => {
    seen.push(options);
    const r = replies[Math.min(i++, replies.length - 1)];
    return {
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: r };
      },
    } as AsyncIterable<unknown>;
  };
  const ps = await driveOne(
    { at: "https://x.test", model: "m", ask, browserAt: "http://localhost:1/mcp" },
    { promise: "p", criteria: [{ id: "AC-1", text: "the cursor is in the title" }, { id: "AC-2", text: "Enter saves" }] },
    1,
  );
  assert.deepEqual(ps.map((p) => p.verdict), ["green", "red"], "both are answered");
  assert.equal(seen.length, 2, "one carry-on, then it stops: the round after that adds nothing");
  assert.ok(seen[1].mcpServers, "and it carries on with the browser, not without it");
});

test("a reviewer that never answers is asked once without the browser, from what it found", async () => {
  const replies = ["I opened the page and made a task.", "I opened the page and made a task.", "1. GREEN it was there"];
  let i = 0;
  const seen: Record<string, unknown>[] = [];
  const ask = async (_p: string, options: Record<string, unknown>) => {
    seen.push(options);
    const r = replies[Math.min(i++, replies.length - 1)];
    return {
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: r };
      },
    } as AsyncIterable<unknown>;
  };
  const ps = await driveOne(
    { at: "https://x.test", model: "m", ask, browserAt: "http://localhost:1/mcp" },
    { promise: "p", criteria: [{ id: "AC-1", text: "the message appears" }] },
    1,
  );
  assert.deepEqual(seen[seen.length - 1].mcpServers, {}, "the last ask has no browser");
  assert.deepEqual(ps.map((p) => p.verdict), ["green"], "so the work it did is not thrown away");
});

test("Stop reaches a reviewer: the round ends and nothing is judged after it", async () => {
  const stop = new AbortController();
  const seen: Record<string, unknown>[] = [];
  const ask = async (_p: string, options: Record<string, unknown>) => {
    seen.push(options);
    return {
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: "I am still looking around." };
      },
    } as AsyncIterable<unknown>;
  };
  // Stopped before it starts: no round is asked at all.
  stop.abort();
  const ps = await driveAll({ at: "https://x.test", model: "m", ask, stop: stop.signal }, [
    { promise: "p", criteria: [{ id: "AC-1", text: "c" }] },
  ]);
  assert.equal(seen.length, 0, "nothing is asked of a stopped run");
  assert.deepEqual(ps.flat().map((p) => p.verdict), ["unjudged"]);
  assert.match(ps[0][0].ref ?? "", /the run was stopped/);
});

test("the round in flight is given the run's own abort", async () => {
  const stop = new AbortController();
  const seen: Record<string, unknown>[] = [];
  const ask = async (_p: string, options: Record<string, unknown>) => {
    seen.push(options);
    return {
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: "1. GREEN done" };
      },
    } as AsyncIterable<unknown>;
  };
  await driveOne(
    { at: "https://x.test", model: "m", ask, stop: stop.signal, browserAt: "http://localhost:1/mcp" },
    { promise: "p", criteria: [{ text: "c" }] },
    1,
  );
  const ctrl = seen[0].abortController as AbortController;
  assert.ok(ctrl, "the round carries an abort");
  stop.abort();
  assert.equal(ctrl.signal.aborted, true, "and the run's Stop fires it");
});

test("a reviewer may use the browser it was given, and nothing else", async () => {
  const { ask, seen } = says("1. GREEN it was there");
  await driveOne(
    { at: "https://x.test", model: "m", ask, browserAt: "http://localhost:1/mcp" },
    { promise: "p", criteria: [{ text: "c" }] },
    1,
  );
  const may = seen[0].canUseTool as (t: string, i: unknown, o: unknown) => Promise<{ behavior: string; message?: string }>;
  assert.equal((await may("mcp__browser__browser_click", {}, {})).behavior, "allow");
  for (const forbidden of [
    "mcp__browser__browser_run_code_unsafe",
    "Monitor",
    "Bash",
    "Read",
    "ToolSearch",
    "mcp__browser__browser_something_new",
  ]) {
    const r = await may(forbidden, {}, {});
    assert.equal(r.behavior, "deny", `${forbidden} is refused`);
    assert.match(r.message ?? "", /not yours to use/);
  }
});

test("a reviewer keeps one conversation and one browser, and both are closed after it", async () => {
  const seen: Record<string, unknown>[] = [];
  const replies = ["1. GREEN one", "1. GREEN one\n2. GREEN two"];
  let i = 0;
  const ask = async (_p: string, options: Record<string, unknown>) => {
    seen.push(options);
    const r = replies[Math.min(i++, replies.length - 1)];
    return {
      [Symbol.asyncIterator]: async function* () {
        yield { type: "system", session_id: "sess-1" };
        yield { type: "result", result: r };
      },
    } as AsyncIterable<unknown>;
  };
  const closed: string[] = [];
  const proofs = await driveAll(
    { at: "https://x.test", model: "m", ask },
    [{ promise: "p", criteria: [{ id: "AC-1", text: "a" }, { id: "AC-2", text: "b" }] }],
    ["on-the-product-1"],
    async (who) => ({ url: `http://localhost:1/${who}`, close: () => closed.push(who) }),
  );
  assert.deepEqual(proofs.flat().map((p) => p.verdict), ["green", "green"]);
  assert.equal(seen[0].resume, undefined, "the first round starts the conversation");
  assert.equal(seen[1].resume, "sess-1", "and the next one continues it, rather than starting a stranger");
  assert.deepEqual(closed, ["on-the-product-1"], "its browser is closed when it is done");
});

test("a reviewer that answers nothing new stops, however differently it says it", async () => {
  let i = 0;
  const replies = ["I looked around a bit.", "I looked around some more.", "I am still looking."];
  const ask = async () =>
    ({
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: replies[Math.min(i++, replies.length - 1)] };
      },
    }) as AsyncIterable<unknown>;
  const proofs = await driveAll(
    { at: "https://x.test", model: "m", ask },
    [{ promise: "p", criteria: [{ id: "AC-1", text: "a" }] }],
    ["r1"],
    async () => ({ url: "http://localhost:1/mcp", close: () => undefined }),
  );
  assert.deepEqual(proofs.flat().map((p) => p.verdict), ["unjudged"]);
  assert.ok(i < 5, `it gave up quickly rather than looping: ${i} rounds`);
});

test("a reviewer whose browser will not start judges nothing, and says why", async () => {
  const ask = async () =>
    ({
      [Symbol.asyncIterator]: async function* () {
        yield { type: "result", result: "1. GREEN" };
      },
    }) as AsyncIterable<unknown>;
  const proofs = await driveAll(
    { at: "https://x.test", model: "m", ask },
    [{ promise: "p", criteria: [{ id: "AC-1", text: "a" }] }],
    ["r1"],
    async () => ({ why: "the browser server stopped before it was ready" }),
  );
  assert.deepEqual(proofs.flat().map((p) => p.verdict), ["unjudged"]);
  assert.match(proofs[0][0].ref ?? "", /stopped before it was ready/);
});

test("a reviewer reports what it noticed and did not judge", async () => {
  const { ask } = says(
    [
      "1. GREEN the cursor was in the title",
      "FINDING: the priority filter reads in English on a Catalan page | ASK: The priority filter reads in Catalan when the page is in Catalan.",
      "FINDING: none of the date fields say what format they want",
    ].join("\n"),
  );
  const ps = await driveOne(
    { at: "https://x.test", model: "m", ask, browserAt: "http://localhost:1/mcp" },
    { promise: "p", criteria: [{ id: "AC-1", text: "the cursor is in the title" }] },
    1,
  );
  assert.deepEqual(ps.map((p) => p.verdict), ["green"], "its verdicts are unaffected");
  assert.deepEqual((ps as typeof ps & { noticed?: unknown }).noticed, [
    {
      saw: "the priority filter reads in English on a Catalan page",
      ask: "The priority filter reads in Catalan when the page is in Catalan.",
    },
    { saw: "none of the date fields say what format they want" },
  ]);
});

test("a reviewer is told the whole path to write its pictures to", async () => {
  // A bare name is written wherever the browser is running, which is not
  // where the report reads pictures from; the whole path lands it there
  // whatever the browser's working directory turns out to be.
  const { ask, asked } = says("1. GREEN the count matched the cards");
  await driveOne(
    {
      at: "https://todo.example.com",
      model: "m",
      ask,
      browserAt: "http://localhost:1/mcp",
      looksIn: "/store/looks/run-1/on-the-product-2",
    },
    { promise: "the count is shown", criteria: [{ text: "the heading counts the cards" }] },
    1,
  );
  assert.match(
    asked[0],
    /\/store\/looks\/run-1\/on-the-product-2\/<item number>-<three to six words, hyphenated>\.png/,
    "the reviewer's own directory is in the instruction",
  );
  assert.match(asked[0], /filename` as a WHOLE PATH/);
});

test("with nowhere to keep pictures, the reviewer is still told how to name one", async () => {
  const { ask, asked } = says("1. GREEN it did");
  await driveOne(
    { at: "https://todo.example.com", model: "m", ask, browserAt: "http://localhost:1/mcp" },
    { promise: "p", criteria: [{ text: "c" }] },
    1,
  );
  assert.match(asked[0], /<item number>-<three to six words, hyphenated>\.png/);
});
