/**
 * The worker that drives a deployed page for one ask.
 *
 * Three days produced a surface where every page rendered at zero height
 * with 391 checks green, because no check anywhere ran the product and
 * looked at it. This is the actor that does, and every rule below exists so
 * that what it says can never cost a delivery — a report that could withhold
 * something is a report someone will argue with, and then it stops arriving.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookAtAsk } from "./lookWorker";

const DEPS = { repoRoot: "/x", model: "sonnet" } as never;
const PAGE = {
  title: "Tandem",
  text: "What I understood of your asks",
  handles: ["data-intent-tab", "data-work-tab"],
  regions: [{ what: "data-intent-page", height: 0, top: 40 }],
};

function surface(pages: (typeof PAGE)[], threw: string[] = []) {
  const pressed: string[] = [];
  let at = 0;
  return {
    pressed,
    open: async () => ({
      read: async () => pages[Math.min(at, pages.length - 1)],
      readWith: async () => undefined,
      act: async () => undefined,
      push: async () => undefined,
      press: async (h: string) => {
        pressed.push(h);
        at += 1;
      },
      threw: () => threw,
      close: async () => undefined,
    }),
  } as never as { pressed: string[]; open: never };
}

const answering = (...replies: string[]) => {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)];
};
const can = async () => undefined;

test("it presses its way to the page the ask is about, then answers", async () => {
  const s = surface([PAGE, PAGE]);
  const r = await lookAtAsk({
    url: "https://todo.example",
    ask: "the asks section is tall enough to read",
    deps: DEPS,
    can,
    open: s.open,
    round: answering("PRESS data-intent-tab", "FOUND the asks section is one centimetre high") as never,
  });
  assert.deepEqual(s.pressed, ["data-intent-tab"], "it went where the ask lives");
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].said, /one centimetre high/, "the person's register, not the machine's");
  assert.match(r.findings[0].where, /the asks section is tall enough/, "and it names the ask it came from");
});

test("silence is the normal answer", async () => {
  const s = surface([PAGE]);
  const r = await lookAtAsk({
    url: "https://todo.example", ask: "the tab row stays put", deps: DEPS, can, open: s.open,
    round: answering("NOTHING") as never,
  });
  assert.deepEqual(r.findings, [], "a worker that always finds something is noise");
  assert.equal(r.looked, true);
});

test("a round that answers nothing is not a complaint about the product", async () => {
  const s = surface([PAGE]);
  const r = await lookAtAsk({
    url: "https://todo.example", ask: "anything", deps: DEPS, can, open: s.open,
    round: answering("") as never,
  });
  assert.deepEqual(r.findings, [], "a broken look reports itself to the log, never to the person");
  assert.ok(r.why, "and says why, where a developer can act on it");
});

test("a page that cannot be opened at all is worth saying", async () => {
  const r = await lookAtAsk({
    url: "https://todo.example", ask: "anything", deps: DEPS, can,
    open: (async () => {
      throw new Error("net::ERR_CONNECTION_REFUSED\n  at …");
    }) as never,
    round: answering("NOTHING") as never,
  });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].said, /could not be opened/);
  assert.doesNotMatch(r.findings[0].said, /\n/, "one line, not a stack");
});

test("it cannot press for ever, and never presses the same thing twice", async () => {
  const s = surface([PAGE, PAGE, PAGE, PAGE, PAGE, PAGE, PAGE, PAGE, PAGE]);
  await lookAtAsk({
    url: "https://todo.example", ask: "anything", deps: DEPS, can, open: s.open,
    round: answering("PRESS data-intent-tab") as never,
  });
  assert.deepEqual(s.pressed, ["data-intent-tab"], "a worker asking for the same gesture is going nowhere");
});

test("it will not press a handle the page does not offer", async () => {
  const s = surface([PAGE]);
  const r = await lookAtAsk({
    url: "https://todo.example", ask: "anything", deps: DEPS, can, open: s.open,
    round: answering("PRESS data-invented-by-the-model") as never,
  });
  assert.deepEqual(s.pressed, [], "the page says what can be pressed; nothing else may be");
  assert.deepEqual(r.findings, []);
});

test("no browser is a fact about this machine, not about the work", async () => {
  const r = await lookAtAsk({
    url: "https://todo.example", ask: "anything", deps: DEPS,
    can: (async () => "no browser is installed") as never,
    open: (() => assert.fail("nothing should be opened")) as never,
    round: answering("NOTHING") as never,
  });
  assert.equal(r.looked, false);
  assert.deepEqual(r.findings, []);
  assert.equal(r.why, "no browser is installed");
});
