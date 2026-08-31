/**
 * The same instrument opens what was built here and what was deployed there.
 *
 * A check before the merge and a look after it are the same act on different
 * trees: open the thing, and measure what a person would see. Giving them
 * two homes would let them disagree about what "drawn" means, and the
 * disagreement would surface as a delivery that passed its checks and failed
 * the person looking at it — which is the failure this whole home exists for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { canRender, openSurface } from "./renderedSurface";

/** A deployed thing, standing in for one — it only has to answer. */
async function somethingDeployed(body: string): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = http.createServer((_q, r) =>
    r.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><body>${body}</body>`),
  );
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/`, stop: () => new Promise<void>((ok) => server.close(() => ok())) };
}

test("it opens something already deployed and measures it", async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);

  const it = await somethingDeployed(`<div data-panel style="height:140px;width:200px">hello</div>`);
  const s = await openSurface({ url: it.url, viewport: { width: 800, height: 600 } });
  try {
    const box = await s.read(() => {
      const r = document.querySelector("[data-panel]")?.getBoundingClientRect();
      return { h: Math.round(r?.height ?? 0), w: Math.round(r?.width ?? 0) };
    });
    assert.deepEqual(box, { h: 140, w: 200 }, "a deployed page is measured the same way a built one is");
  } finally {
    await s.close();
    await it.stop();
  }
});

test("it says why it cannot look, rather than failing obscurely", async () => {
  const why = await canRender("/nowhere/at/all");
  assert.match(why ?? "", /not built|no browser/, "a missing surface is said in words, not as a stack trace");
});

test("it refuses to open nothing at all", async () => {
  await assert.rejects(() => openSurface({}), /needs a built surface or a url/);
});

test("a page that redirects under the reader is still read", async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);

  // Deployed things redirect — to a sign-in, to a canonical host — and the
  // context a read started in is then gone. Thrown at the caller that reads
  // as "the look failed", when the page simply moved and is readable a
  // moment later. Found by pointing this at a real cluster.
  let hops = 0;
  const server = http.createServer((q, r) => {
    if ((q.url ?? "/") === "/") {
      hops++;
      return r
        .writeHead(200, { "content-type": "text/html" })
        .end(`<!doctype html><body><script>location.replace("/login")</script></body>`);
    }
    r.writeHead(200, { "content-type": "text/html" }).end(
      `<!doctype html><body><div data-panel style="height:80px;width:120px">signed out</div></body>`,
    );
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as { port: number };
  const s = await openSurface({ url: `http://127.0.0.1:${port}/`, viewport: { width: 800, height: 600 } });
  try {
    const seen = await s.read(() => ({
      where: location.pathname,
      panel: Math.round(document.querySelector("[data-panel]")?.getBoundingClientRect().height ?? 0),
    }));
    assert.equal(hops, 1);
    assert.deepEqual(seen, { where: "/login", panel: 80 }, "it followed the move and measured where it landed");
  } finally {
    await s.close();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
});
