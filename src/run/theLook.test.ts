/**
 * The look reports what a person would notice, and never a verdict.
 *
 * A gate can only ask what a check proves before anything ships. This asks
 * what the deployed thing looks like afterwards — the step that was missing
 * when a window whose every page was laid out at zero height went out with
 * three hundred and ninety-one checks green.
 *
 * Silence is the normal answer: a look that always finds something is noise,
 * and noise is a ledger nobody reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { canRender } from "../gates/renderedSurface";
import { theLook } from "./theLook";

async function deployed(body: string): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = http.createServer((_q, r) =>
    r.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><body>${body}</body>`),
  );
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/`, stop: () => new Promise<void>((ok) => server.close(() => ok())) };
}

async function lookAt(body: string): Promise<string[]> {
  const it = await deployed(body);
  try {
    const r = await theLook({ url: it.url, viewport: { width: 900, height: 700 } });
    return r.findings.map((f) => f.said);
  } finally {
    await it.stop();
  }
}

test("a thing that works is reported in silence", async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  const said = await lookAt(`<div data-write-page style="height:400px">something to read<button>Do it</button></div>`);
  assert.deepEqual(said, [], "nothing to say is the normal answer, and it says nothing");
});

test("a blank page is noticed, which is what shipped green", async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  const said = await lookAt("");
  assert.equal(said.length, 1);
  assert.match(said[0], /blank/);
});

test("a page drawn with no height is noticed, and named", async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  // Exactly the failure of that delivery: present in the document, absent
  // from the window, and every check about its source still true.
  const said = await lookAt(
    `<button>press me</button><div data-intent-page style="height:0;overflow:hidden">lots of content</div>`,
  );
  assert.ok(
    said.some((x) => /data-intent-page is drawn with no height/.test(x)),
    `expected the collapsed page to be named, got: ${said.join(" | ")}`,
  );
});

test("what the page itself throws is carried, not just its emptiness", async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  // A surface with no error boundary unmounts on its first throw and then
  // looks merely empty, so emptiness alone would never say why.
  const said = await lookAt(`<button>x</button><script>setTimeout(() => { throw new Error("nope"); }, 0)</script>`);
  assert.ok(said.some((x) => /the page threw: .*nope/.test(x)), `got: ${said.join(" | ")}`);
});

test("somewhere that cannot be reached is said plainly, not thrown", async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  const r = await theLook({ url: "http://127.0.0.1:1/" });
  assert.equal(r.looked, true);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].said, /could not be opened/);
});

test("with no browser it says so, and reports nothing about the work", async () => {
  const before = process.env.TANDEM_BROWSER;
  process.env.TANDEM_BROWSER = "/nowhere/at/all";
  try {
    // A machine that cannot look has learned nothing about the product; it
    // must never let that read as the product being fine.
    const r = await theLook({ url: "http://127.0.0.1:1/" });
    assert.equal(r.looked, false);
    assert.deepEqual(r.findings, []);
    assert.match(r.why ?? "", /no browser/);
  } finally {
    if (before === undefined) delete process.env.TANDEM_BROWSER;
    else process.env.TANDEM_BROWSER = before;
  }
});
