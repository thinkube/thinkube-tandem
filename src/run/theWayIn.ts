/**
 * The way in, for a reviewer of the running product.
 *
 * The product sits behind the platform's single sign-on, and a reviewer's
 * browser starts cold, so it lands on a login page and can judge nothing.
 * It is given a session instead: signed in once here, outside the model,
 * and handed over as a file the browser starts from.
 *
 * Two limits make that session safe to hand over. The password is typed
 * by this code and never enters a prompt or a log. And the session is cut
 * down to the product's own origin — the sign-on cookie is dropped — so
 * it opens the product and nothing else on the platform, whatever the
 * browser is later asked to do.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

export interface Credentials {
  username: string;
  password: string;
}

/**
 * The platform's one identity: the realm user it signs people in as, and
 * the admin password.
 *
 * The environment first; then the two files the platform keeps them in —
 * the shell environment it loads for its own tools, and the inventory
 * that names the realm user. The password never leaves this module.
 */
export function credentialsFrom(
  env: NodeJS.ProcessEnv = process.env,
  home = process.env.HOME ?? "~",
): Credentials | undefined {
  const dotEnv = readDotEnv(path.join(home, ".env"));
  const username =
    env.AUTH_REALM_USERNAME ||
    dotEnv.AUTH_REALM_USERNAME ||
    fromInventory(home, "auth_realm_username") ||
    env.ADMIN_USERNAME ||
    dotEnv.ADMIN_USERNAME;
  const password = env.ADMIN_PASSWORD || dotEnv.ADMIN_PASSWORD;
  return username && password ? { username, password } : undefined;
}

/** `KEY=value` lines, quotes stripped; nothing else is interpreted. */
function readDotEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** One value from the platform's own inventory, when it is on this machine. */
function fromInventory(home: string, key: string): string | undefined {
  try {
    const text = fs.readFileSync(path.join(home, ".ansible", "inventory", "inventory.yaml"), "utf8");
    return new RegExp("^\\s*" + key + "\\s*:\\s*(\\S+)\\s*$", "m").exec(text)?.[1];
  } catch {
    return undefined;
  }
}

/** A saved browser session, as Playwright writes and reads it. */
interface StorageState {
  cookies: { name: string; domain: string; path: string; [k: string]: unknown }[];
  origins: { origin: string; [k: string]: unknown }[];
}

/** The host of an address, without its port. */
function hostOf(at: string): string {
  try {
    return new URL(at).hostname;
  } catch {
    return at;
  }
}

/**
 * Names that carry a way back in, as opposed to a display preference.
 */
const CREDENTIAL = /(token|auth|session|jwt|credential|identity|bearer|api[_-]?key)/i;

/**
 * What in this state is a way back into the product, rather than a
 * preference the page happened to save.
 *
 * A cookie on the product's own host is how a server keeps a session; a
 * stored item is one only when its name says so. A theme is neither, and
 * a session made only of a theme opens nothing.
 */
export function credentialsIn(state: StorageState, at: string): string[] {
  const host = hostOf(at);
  const out: string[] = [];
  for (const c of state.cookies ?? []) if (c.domain.replace(/^\./, "") === host) out.push(`cookie ${c.name}`);
  for (const o of state.origins ?? [])
    if (hostOf(o.origin) === host)
      for (const item of (o as { localStorage?: { name: string }[] }).localStorage ?? [])
        if (CREDENTIAL.test(item.name)) out.push(`stored ${item.name}`);
  return out;
}

/**
 * Keep only what belongs to the product's own host.
 *
 * A cookie for the sign-on host is a key to every other thing on the
 * platform; a cookie for the product's host opens the product. Exported
 * for its own test: this is the rule that makes handing a session over
 * safe, so it is proved directly rather than through a browser.
 */
export function onlyThisProduct(state: StorageState, at: string): StorageState {
  const host = hostOf(at);
  const mine = (domain: string): boolean => {
    const d = domain.replace(/^\./, "");
    return d === host;
  };
  return {
    cookies: (state.cookies ?? []).filter((c) => mine(c.domain)),
    origins: (state.origins ?? []).filter((o) => hostOf(o.origin) === host),
  };
}

/**
 * Sign in once and write the session for the reviewers to start from.
 *
 * Returns the file's path, or why there is no way in — a reviewer with no
 * session says it could not get in, and judges nothing.
 */
export async function signInOnce(a: {
  at: string;
  into: string;
  credentials?: Credentials;
  /** Injectable for tests: what actually drives the sign-in. */
  signIn?: (a: { at: string; credentials: Credentials }) => Promise<StorageState>;
}): Promise<{ path: string } | { why: string }> {
  const credentials = a.credentials ?? credentialsFrom();
  if (!credentials) return { why: "no identity is available on this machine to sign in with" };
  try {
    const state = await (a.signIn ?? signInWithABrowser)({ at: a.at, credentials });
    const kept = onlyThisProduct(state, a.at);
    if (!credentialsIn(kept, a.at).length)
      return { why: `signing in left no way back in for ${hostOf(a.at)} — the product set no session, only preferences` };
    fs.mkdirSync(path.dirname(a.into), { recursive: true });
    fs.writeFileSync(a.into, JSON.stringify(kept, null, 2));
    return { path: a.into };
  } catch (err) {
    return { why: `could not sign in: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * The chrome installed on this machine, when the library's own build is
 * not the one here. Nothing when the library can find its own.
 */
function chromeOnThisMachine(): { executablePath: string } | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.HOME ?? "~", ".cache", "ms-playwright");
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort();
  } catch {
    return undefined;
  }
  for (const d of dirs.reverse()) {
    const exe = path.join(root, d, "chrome-linux64", "chrome");
    if (fs.existsSync(exe)) return { executablePath: exe };
    const alt = path.join(root, d, "chrome-linux", "chrome");
    if (fs.existsSync(alt)) return { executablePath: alt };
  }
  return undefined;
}

/** Where the machine keeps Playwright: this package, else beside the
 *  browser server the reviewers are started with. */
function playwrightFrom(): unknown {
  const req = createRequire(__filename);
  try {
    return req("playwright");
  } catch {
    /* not a dependency here — look where the platform keeps it */
  }
  const roots = (() => {
    try {
      return [execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim()];
    } catch {
      return [];
    }
  })();
  for (const root of roots) {
    try {
      return req(path.join(root, "@playwright", "mcp", "node_modules", "playwright"));
    } catch {
      /* try the next */
    }
  }
  throw new Error("no browser is installed on this machine to sign in with");
}

/**
 * Does that session actually open the product?
 *
 * A session that was written but is not applied — expired, or handed to a
 * browser that ignores it — sends every reviewer to the sign-on host,
 * where its own origin limit refuses it. Asked once here, before any
 * reviewer is started, so the answer is one line rather than a wall of
 * blocked criteria.
 */
export async function theWayInWorks(a: {
  at: string;
  sessionFile: string;
  /** Injectable for tests: what actually opens the page. */
  visit?: (a: { at: string; sessionFile: string }) => Promise<{ landedAt: string }>;
}): Promise<{ ok: true } | { why: string }> {
  try {
    const { landedAt } = await (a.visit ?? visitWithABrowser)({ at: a.at, sessionFile: a.sessionFile });
    const wanted = new URL(a.at).host;
    const got = (() => {
      try {
        return new URL(landedAt).host;
      } catch {
        return landedAt;
      }
    })();
    return got === wanted
      ? { ok: true }
      : { why: `the session does not open the product: ${a.at} sent the browser to ${got}` };
  } catch (err) {
    return { why: `the product could not be opened with that session: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Open the address with that session and say where the browser ended up. */
async function visitWithABrowser(a: { at: string; sessionFile: string }): Promise<{ landedAt: string }> {
  const { chromium } = playwrightFrom() as unknown as {
    chromium: {
      launch: (o: { headless: boolean; executablePath?: string }) => Promise<{
        newContext: (o: { storageState: string }) => Promise<{
          newPage: () => Promise<Record<string, (...args: unknown[]) => Promise<unknown>> & { url: () => string }>;
          close: () => Promise<void>;
        }>;
        close: () => Promise<void>;
      }>;
    };
  };
  const browser = await chromium.launch({ headless: true, ...(chromeOnThisMachine() ?? {}) });
  try {
    const context = await browser.newContext({ storageState: a.sessionFile });
    const page = await context.newPage();
    await page.goto(a.at, { waitUntil: "networkidle", timeout: 60000 });
    return { landedAt: page.url() };
  } finally {
    await browser.close();
  }
}

/**
 * The sign-in itself: open the address, follow the platform's login form,
 * and read the browser's state back. Playwright is loaded here and only
 * here, so a machine without it says so instead of failing elsewhere.
 */
async function signInWithABrowser(a: { at: string; credentials: Credentials }): Promise<StorageState> {
  // The browser belongs to the machine, not to this extension: it is
  // resolved where the platform keeps it — beside the browser server the
  // reviewers already use — so nothing here is installed twice.
  const { chromium } = playwrightFrom() as unknown as {
    chromium: {
      launch: (o: { headless: boolean; executablePath?: string }) => Promise<{
        newContext: () => Promise<{
          newPage: () => Promise<Record<string, (...args: unknown[]) => Promise<unknown>>>;
          storageState: () => Promise<StorageState>;
          close: () => Promise<void>;
        }>;
        close: () => Promise<void>;
      }>;
    };
  };
  // The library and the installed browser can be different versions, so
  // the browser is named by the file that is actually here.
  const browser = await chromium.launch({ headless: true, ...(chromeOnThisMachine() ?? {}) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(a.at, { waitUntil: "domcontentloaded", timeout: 60000 });
    // The platform's own sign-in form. Named by what a person sees, so a
    // change of theme does not break it.
    await page.fill('input[name="username"], input#username', a.credentials.username);
    await page.fill('input[name="password"], input#password', a.credentials.password);
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForURL((u: unknown) => String(u).startsWith(new URL(a.at).origin), { timeout: 60000 });
    // The redirect lands on the callback, where the product still has to
    // exchange the code for its session. That exchange is what is waited
    // for — the session appearing — rather than a quiet network, which
    // also goes quiet in the gap before the exchange starts.
    const until = Date.now() + 60000;
    let state = await context.storageState();
    while (!credentialsIn(state, a.at).length && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 250));
      state = await context.storageState();
    }
    return state;
  } finally {
    await browser.close();
  }
}
