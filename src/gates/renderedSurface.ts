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
import type { Browser, Page } from "playwright-core";

/**
 * The browser driver, loaded when a browser is wanted and not before.
 *
 * Imported at the top of the file it is pulled in by everything that merely
 * MENTIONS looking — the MCP server took long enough to start that its own
 * handshake timed out, for a tool nobody had called yet.
 */
async function driver(): Promise<typeof import("playwright-core").chromium> {
  return (await import("playwright-core")).chromium;
}

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
// Read when it is used, not when this module loads: a caller that points
// it elsewhere — or a check that proves the no-browser path — must be able
// to, and an import-time constant cannot be pointed anywhere.
const browserPath = (): string => process.env.TANDEM_BROWSER ?? "/usr/bin/chromium-browser";

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
  /** What the page threw, from the moment it was opened. Collected here
   *  because a surface with no error boundary unmounts on its first throw
   *  and then merely LOOKS empty — the emptiness alone never says why. */
  threw(): readonly string[];
  close(): Promise<void>;
}

/** Whether this machine can render at all — said plainly, never guessed. */
export async function canRender(mediaRoot?: string): Promise<string | undefined> {
  if (!(await fs.stat(browserPath()).then(() => true, () => false)))
    return `no browser at ${browserPath()} — set TANDEM_BROWSER to one`;
  if (mediaRoot && !(await fs.stat(path.join(mediaRoot, "index.html")).then(() => true, () => false)))
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
  /** A built surface on disk, served here. */
  mediaRoot?: string;
  /** Or a thing already deployed — the same instrument, pointed at what the
   *  merge produced rather than at what the worktree built. A check before
   *  the merge and a look after it are the same act on different trees, and
   *  giving them one home means they can never disagree about what "drawn"
   *  means. */
  url?: string;
  viewport?: { width: number; height: number };
}): Promise<OpenSurface> {
  if (!a.mediaRoot && !a.url) throw new Error("openSurface needs a built surface or a url");
  const root = a.mediaRoot ? path.resolve(a.mediaRoot) : "";
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
  if (root) await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const at = root ? `http://127.0.0.1:${(server.address() as { port: number }).port}/index.html` : a.url!;

  const threw: string[] = [];
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    browser = await (await driver()).launch({ executablePath: browserPath(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    page = await browser.newPage({ viewport: a.viewport ?? { width: 1100, height: 800 } });
    page.on("pageerror", (e) => threw.push(e.message.split("\n")[0]));
    page.on("console", (m) => {
      if (m.type() === "error") threw.push(m.text().split("\n")[0]);
    });
    await page.goto(at, { waitUntil: "load" });
  } catch (err) {
    await browser?.close().catch(() => {});
    if (root) await new Promise<void>((ok) => server.close(() => ok()));
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
    threw: () => threw,
    press: async (handle) => {
      await open.click(`[${handle}]`);
      await settle();
    },
    close: async () => {
      await browser?.close().catch(() => {});
      if (root) await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
