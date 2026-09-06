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

/** The platform's one identity, from the environment it is kept in. */
export function credentialsFrom(env: NodeJS.ProcessEnv = process.env): Credentials | undefined {
  const username = env.ADMIN_USERNAME || env.POSTGRES_USER;
  const password = env.ADMIN_PASSWORD || env.POSTGRES_PASSWORD;
  return username && password ? { username, password } : undefined;
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
    if (!kept.cookies.length && !kept.origins.length)
      return { why: `signing in left nothing for ${hostOf(a.at)} — the product did not set a session` };
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
    return await context.storageState();
  } finally {
    await browser.close();
  }
}
