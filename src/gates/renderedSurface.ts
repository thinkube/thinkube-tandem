/**
 * The surface, actually rendered, so a check can measure what a person sees.
 *
 * Every check this repository had asked what a source file SAYS. None ran
 * the product and looked at it, so a delivery of a hundred and ninety proofs
 * went out green over a window in which every page was laid out at zero
 * height and pushed below the fold. Each proof was honest; none of them was
 * about the thing that was broken.
 *
 * This is the home for the checks that are: the built surface is served,
 * opened in a real browser at a real size, given a push, and then measured
 * through the DOM. A layout is a property of a running page and of nothing
 * else — no reading of the source can stand in for it.
 *
 * The browser is the one already on the machine; nothing is downloaded.
 */
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

/** Where a webview asset is served from and what it is called. */
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
};

/**
 * The browser to drive.
 *
 * Playwright's own download is not used: this machine already carries a
 * Chromium, and a check that fetches a browser is a check that fails behind
 * a firewall for a reason having nothing to do with the work.
 */
const BROWSER = process.env.TANDEM_BROWSER ?? "/usr/bin/chromium-browser";

export interface OpenSurface {
  /** Run an expression in the page and return what it produced. */
  read<T>(fn: () => T): Promise<T>;
  /** The same, with one value handed to the page. */
  readWith<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  /** Do something in the page and wait for the surface to settle after it.
   *  Reading straight after a click measures the DOM mid-render, which is a
   *  race that reports whatever it happens to catch. */
  act<A>(fn: (arg: A) => void, arg: A): Promise<void>;
  /** Send the surface a push, as the host does, and let it settle. */
  push(state: unknown): Promise<void>;
  /** Press a control the surface draws, by its data attribute. */
  press(handle: string): Promise<void>;
  close(): Promise<void>;
}

/** Whether this machine can render at all — said plainly, never guessed. */
export async function canRender(mediaRoot: string): Promise<string | undefined> {
  if (!(await fs.stat(BROWSER).then(() => true, () => false)))
    return `no browser at ${BROWSER} — set TANDEM_BROWSER to one`;
  if (!(await fs.stat(path.join(mediaRoot, "index.html")).then(() => true, () => false)))
    return `the surface is not built at ${mediaRoot} — run the product build first`;
  return undefined;
}

/**
 * Serve a built surface and open it.
 *
 * Served over http rather than opened as a file, because the surface is an
 * ES module and a browser refuses to load one from `file:`.
 */
export async function openSurface(a: {
  mediaRoot: string;
  viewport?: { width: number; height: number };
}): Promise<OpenSurface> {
  const root = path.resolve(a.mediaRoot);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, rel);
    // Never outside the served tree, whatever the request says.
    if (!file.startsWith(root)) return res.writeHead(403).end();
    fs.readFile(file).then(
      (body) => res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body),
      () => res.writeHead(404).end(),
    );
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;

  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    browser = await chromium.launch({ executablePath: BROWSER, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    page = await browser.newPage({ viewport: a.viewport ?? { width: 1100, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
  } catch (err) {
    await browser?.close().catch(() => {});
    await new Promise<void>((ok) => server.close(() => ok()));
    throw err;
  }
  const open = page;

  // The page's own globals are not typed here — this module is host code,
  // and giving it the DOM would let host code reach for a document.
  const settle = async (): Promise<void> => {
    // The surface renders on its own schedule, so waiting a fixed number of
    // frames is a race that passes on a fast machine and fails on a busy
    // one. Wait for it to be quiet instead.
    await open.waitForLoadState("networkidle").catch(() => {});
    await open.evaluate(
      "new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => ok(0), 120))))",
    );
  };
  return {
    read: <T>(fn: () => T) => open.evaluate(fn) as Promise<T>,
    readWith: <T, A>(fn: (arg: A) => T, arg: A) =>
      open.evaluate(fn as never, arg as never) as Promise<T>,
    act: async <A>(fn: (arg: A) => void, arg: A) => {
      await open.evaluate(fn as never, arg as never);
      await settle();
    },
    push: async (state) => {
      // A function, not a string: playwright evaluates a string expression
      // and never hands it the argument, so a pushed state written that way
      // arrives nowhere and the surface stays empty with nothing said.
      // `globalThis` is the page's window here, and needs no DOM types.
      await open.evaluate(
        (s) => (globalThis as { postMessage?: (m: unknown, o: string) => void }).postMessage?.(s, "*"),
        state,
      );
      await settle();
    },
    press: async (handle) => {
      await open.click(`[${handle}]`);
      await settle();
    },
    close: async () => {
      await browser?.close().catch(() => {});
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
