/**
 * The extension registers its own server.
 *
 * A registration written by hand lives on one machine and dies with it:
 * reinstall, and the entry is gone with no trace of what it said. The
 * extension knows where it is installed, so it is the only thing that can
 * keep the entry correct across versions — and it must point at the
 * VERSION-INDEPENDENT path, because a registration naming
 * `…-2.0.189/out/…` breaks silently at the next deploy, which is exactly
 * how the previous server's entry came to point at a directory that no
 * longer existed.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** The stable path a registration may name: repointed by every deploy. */
export const STABLE_SERVER = path.join("extension-current", "out", "mcp", "server.js");

export interface Registration {
  command: string;
  args: string[];
}

/** What the entry should say, given where the extension keeps its state. */
export function registrationFor(globalStorage: string): Registration {
  return { command: "node", args: [path.join(globalStorage, STABLE_SERVER)] };
}

/**
 * Ensure the config names this server, correctly. Returns what changed, so
 * a caller can say so once rather than every activation.
 *
 * Idempotent by comparison, never by blind write: a config a person edited
 * for other servers must survive, and an entry that is already right must
 * not be rewritten on every window.
 */
export function ensureRegistered(
  configFile: string,
  globalStorage: string,
): "added" | "corrected" | "unchanged" | "unwritable" {
  const want = registrationFor(globalStorage);
  let doc: Record<string, unknown> = {};
  try {
    doc = JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, unknown>;
  } catch {
    // A missing config is not an error — it is the first run.
  }
  const servers = (doc.mcpServers ?? {}) as Record<string, unknown>;
  const had = servers["thinkube-tandem"] as Registration | undefined;
  const same =
    had?.command === want.command &&
    Array.isArray(had?.args) &&
    had.args.length === want.args.length &&
    had.args.every((a, i) => a === want.args[i]);
  if (same) return "unchanged";
  const outcome = had ? "corrected" : "added";
  doc.mcpServers = { ...servers, "thinkube-tandem": want };
  try {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, `${JSON.stringify(doc, null, 2)}\n`);
  } catch {
    // A registration that cannot be written costs the server, never the
    // editor: the person can still do everything through the window.
    return "unwritable";
  }
  return outcome;
}

/**
 * Keep the registration correct for this installation, and say so once
 * when it changed. The extension is the only thing that knows where it
 * lives, so it is the only thing that can keep the entry true.
 */
export function registerServer(globalStorage: string, home = process.env.HOME ?? ""): void {
  const outcome = ensureRegistered(path.join(home, ".claude.json"), globalStorage);
  if (outcome === "added" || outcome === "corrected")
    console.log(`tandem: mcp server registration ${outcome}`);
}
