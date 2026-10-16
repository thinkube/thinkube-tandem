/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The extension no longer registers its server by hand.
 *
 * The Tandem plugin (`claude-plugins/tandem`) declares the server to Claude
 * Code through the same version-independent path, and the platform installs
 * the plugin from the marketplace the extension ships beside its code. A
 * registration written by hand lived on one machine and died with it; a
 * plugin is installed, listed, updated and removed by the tool that reads
 * it.
 *
 * What remains here is the clean-up: an entry this extension wrote into
 * `~/.claude.json` in earlier versions is removed, so the server is not
 * registered twice — once by the plugin and once by hand. An entry under
 * the same name that points anywhere else is somebody's own, and is left
 * alone.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** The stable path the hand-written entry named: repointed by every deploy. */
export const STABLE_SERVER = path.join("extension-current", "out", "mcp", "server.js");

export interface Registration {
  command: string;
  args: string[];
}

/** What the extension used to write, so that only its own entry is removed. */
export function registrationFor(globalStorage: string): Registration {
  return { command: "node", args: [path.join(globalStorage, STABLE_SERVER)] };
}

/**
 * Remove the entry this extension wrote, when it is there. Returns what
 * changed, so a caller can say so once rather than every activation.
 */
export function retireHandRegistration(
  configFile: string,
  globalStorage: string,
): "removed" | "unchanged" | "unwritable" {
  const ours = registrationFor(globalStorage);
  let doc: Record<string, unknown> = {};
  try {
    doc = JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, unknown>;
  } catch {
    return "unchanged";
  }
  const servers = (doc.mcpServers ?? {}) as Record<string, unknown>;
  const had = servers["thinkube-tandem"] as Registration | undefined;
  const isOurs =
    had?.command === ours.command &&
    Array.isArray(had?.args) &&
    had.args.length === ours.args.length &&
    had.args.every((a, i) => a === ours.args[i]);
  if (!isOurs) return "unchanged";
  const { "thinkube-tandem": _gone, ...rest } = servers;
  void _gone;
  doc.mcpServers = rest;
  try {
    fs.writeFileSync(configFile, `${JSON.stringify(doc, null, 2)}\n`);
  } catch {
    // A config that cannot be written leaves a second registration behind,
    // never a broken editor: the person still has everything in the window.
    return "unwritable";
  }
  return "removed";
}

/** Retire the hand-written registration for this installation, and say so
 *  once when it was there. */
export function retireServerRegistration(globalStorage: string, home = process.env.HOME ?? ""): void {
  const outcome = retireHandRegistration(path.join(home, ".claude.json"), globalStorage);
  if (outcome === "removed")
    console.log("tandem: the hand-written mcp server entry was removed — the Tandem plugin registers the server");
}
