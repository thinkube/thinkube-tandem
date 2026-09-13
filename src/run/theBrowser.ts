/**
 * The browser a reviewer is given, started and answering before it exists.
 *
 * Handing the harness a command to spawn leaves a window in which the
 * reviewer's first turn has no browser tools: it then looks for tools it
 * can see and works with those instead of the product. So the server is
 * started here, waited for until it says it is listening, and given to the
 * reviewer as an address. A server that never comes up is said plainly and
 * no reviewer is started against it.
 *
 * One server serves every reviewer of a run: each opens its own page, and
 * the browser is closed when the run is done with it.
 */
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface TheBrowser {
  /** Where the reviewers' harness connects. */
  url: string;
  /** What the server said while starting, kept for the record. */
  said: string[];
  close: () => void;
}

/** The browser server this machine has, else one fetched on the spot. */
export function serverHere(home = process.env.HOME ?? "~"): { command: string; args: string[] } {
  const installed = ["playwright-mcp", "mcp-server-playwright"]
    .map((n) => path.join(home, ".npm-global", "bin", n))
    .find((p) => fs.existsSync(p));
  return installed ? { command: installed, args: [] } : { command: "npx", args: ["-y", "@playwright/mcp@latest"] };
}

/**
 * The chrome installed on this machine, when there is one.
 *
 * Playwright keeps its browsers under a versioned directory
 * (`chromium-1234/chrome-linux64/chrome`) below PLAYWRIGHT_BROWSERS_PATH or
 * its cache; a platform image may keep one build directly under that
 * root, or install the system's own chromium. Every one of those is a
 * chrome that can drive the running product, and the library's own guess
 * — a headless shell that was never downloaded — is not.
 */
export function chromeOnThisMachine(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = fs.existsSync,
  list: (dir: string) => string[] = (dir) => fs.readdirSync(dir),
): string | undefined {
  const root = env.PLAYWRIGHT_BROWSERS_PATH || path.join(env.HOME ?? "~", ".cache", "ms-playwright");
  const under = ["chrome-linux64/chrome", "chrome-linux/chrome"];
  let dirs: string[] = [];
  try {
    dirs = list(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  } catch {
    dirs = [];
  }
  for (const d of dirs)
    for (const u of under) {
      const exe = path.join(root, d, u);
      if (exists(exe)) return exe;
    }
  for (const u of under) {
    const exe = path.join(root, u);
    if (exists(exe)) return exe;
  }
  for (const exe of ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"])
    if (exists(exe)) return exe;
  return undefined;
}

/** The address the server prints when it is ready to be talked to. */
export function listeningAt(said: string): string | undefined {
  return /Listening on (http:\/\/\S+)/.exec(said)?.[1];
}

/**
 * Start it and wait until it answers. The port is the server's to choose:
 * asking for zero and reading back what it printed avoids picking one that
 * is already taken.
 */
export async function openTheBrowser(a: {
  /** The one origin any page may be opened on. */
  origin: string;
  /** Where screenshots and page snapshots are written. */
  outputDir?: string;

  /** A signed-in session for that origin. */
  sessionFile?: string;
  patienceMs?: number;
  /** Injectable for tests. */
  start?: (cmd: string, args: string[]) => ChildProcess;
  log?: (line: string) => void;
}): Promise<TheBrowser | { why: string }> {
  const server = serverHere();
  const chrome = chromeOnThisMachine();
  const args = [
    ...server.args,
    "--headless",
    // Isolated, because the signed-in session is handed over as a file and
    // the server applies it to isolated sessions only. A reviewer that
    // starts from a profile instead arrives signed out, is redirected to
    // the sign-on host, and is refused there by its own origin limit.
    "--isolated",
    "--port",
    "0",
    "--allowed-origins",
    a.origin,
    "--viewport-size",
    "1440,900",
    ...(a.outputDir ? ["--output-dir", a.outputDir] : []),
    ...(a.sessionFile ? ["--storage-state", a.sessionFile] : []),
    ...(chrome ? ["--executable-path", chrome] : []),
  ];
  // The server writes a named screenshot relative to its own working
  // directory, and its snapshots and logs to --output-dir. Started in that
  // same directory, both land together beside the run's record.
  if (a.outputDir) fs.mkdirSync(a.outputDir, { recursive: true });
  const child = (
    a.start ??
    ((cmd, ar) =>
      spawn(cmd, ar, { stdio: ["ignore", "pipe", "pipe"], ...(a.outputDir ? { cwd: a.outputDir } : {}) }))
  )(server.command, args);
  const said: string[] = [];
  let url: string | undefined;
  const read = (d: Buffer | string): void => {
    const text = String(d);
    said.push(text.trim());
    url = url ?? listeningAt(text);
  };
  child.stdout?.on("data", read);
  child.stderr?.on("data", read);
  const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let over = false;
  void gone.then(() => (over = true));

  const patience = a.patienceMs ?? 30_000;
  const began = Date.now();
  while (!url && !over && Date.now() - began < patience)
    await new Promise((r) => setTimeout(r, 200));

  if (!url) {
    child.kill();
    return {
      why: over
        ? `the browser server stopped before it was ready: ${said.join(" ").slice(-300) || "it said nothing"}`
        : `the browser server did not answer within ${Math.round(patience / 1000)}s: ${said.join(" ").slice(-300) || "it said nothing"}`,
    };
  }
  a.log?.(`the browser is up at ${url}`);
  return {
    url: url.replace(/\/$/, "") + "/mcp",
    said,
    close: () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    },
  };
}
