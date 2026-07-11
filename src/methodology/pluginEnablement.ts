/**
 * Plugin enablement — how a repo opts IN to the Tandem
 * methodology plugin, PER-REPO and never global.
 *
 * Proven shape (verified via the spike + liveness runs):
 *   1. the marketplace is registered ONCE per machine (`claude plugin
 *      marketplace add <local clone>`) — a one-shot command; the machine-specific
 *      path lives in `~/.claude`, never in a repo;
 *   2. the repo's committed `.claude/settings.json` carries ONLY
 *      `enabledPlugins: { "tandem-methodology@thinkube": true }` (map-form,
 *      PORTABLE — just the plugin id).
 * On a trusted session in that repo the plugin then auto-installs and the
 * methodology is live; repos without the entry get nothing.
 *
 * `applyPluginEnablement` is PURE (no vscode/fs) → unit-tested. The fs/process
 * wrappers below are thin glue for the per-repo opt-in ("Enable Methodology Here").
 */
import { promises as fs, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Marketplace name (the `@<mp>` suffix on the plugin id). */
export const MARKETPLACE_NAME = "thinkube";
/** Fully-qualified plugin id used in `enabledPlugins`. */
export const PLUGIN_ID = `tandem-methodology@${MARKETPLACE_NAME}`;

type Settings = Record<string, unknown>;

export interface EnablementResult {
  settings: Settings;
  /** True iff the output differs from the input (drives idempotent writes). */
  changed: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Coerce `enabledPlugins` to map-form, preserving prior entries. */
function toEnabledMap(v: unknown): Record<string, unknown> {
  if (Array.isArray(v)) {
    const m: Record<string, unknown> = {};
    for (const e of v) if (typeof e === "string") m[e] = true;
    return m;
  }
  return isPlainObject(v) ? { ...v } : {};
}

/**
 * Enable the methodology plugin in a parsed settings object — map-form
 * `enabledPlugins[PLUGIN_ID] = true`, idempotent and non-clobbering (only that
 * one entry is touched; permissions / hooks / other plugins are preserved; a
 * legacy array is upgraded to map-form). `changed` is false when already set.
 */
export function applyPluginEnablement(input: Settings | null | undefined): EnablementResult {
  const before: Settings = isPlainObject(input) ? input : {};
  const enabled = toEnabledMap(before.enabledPlugins);
  const already = enabled[PLUGIN_ID] === true && !Array.isArray(before.enabledPlugins);
  enabled[PLUGIN_ID] = true;
  return { settings: { ...before, enabledPlugins: enabled }, changed: !already };
}

/** A discovered Claude Code marketplace hosted in a `*-metadata` repo. */
export interface MetadataMarketplace {
  /** The repo name (e.g. `thinkube-metadata`, `acme-metadata`). */
  repo: string;
  /** Absolute path to the repo (the directory marketplace source). */
  path: string;
  /** The marketplace `name` from its `.claude-plugin/marketplace.json`. */
  marketplaceName: string;
}

/**
 * The metadata-repo marketplaces among `repos`: every repo
 * named `*-metadata` that carries a `.claude-plugin/marketplace.json`, paired with
 * that manifest's `name`. Covers the official `thinkube-metadata` AND each user's
 * own `{org}-metadata` — org-agnostic, discovered structurally. Pure: the manifest
 * read is injected (`readMarketplaceName` → the name, or null when absent/invalid).
 */
export function discoverMetadataMarketplaces(
  repos: { name: string; path: string }[],
  readMarketplaceName: (repoPath: string) => string | null,
): MetadataMarketplace[] {
  const out: MetadataMarketplace[] = [];
  for (const r of repos) {
    if (!r.name.endsWith("-metadata")) continue;
    const marketplaceName = readMarketplaceName(r.path);
    if (marketplaceName) out.push({ repo: r.name, path: r.path, marketplaceName });
  }
  return out;
}

/** Read the `name` from `<repoPath>/.claude-plugin/marketplace.json`, or null. */
export function readMarketplaceName(repoPath: string): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(
        path.join(repoPath, ".claude-plugin", "marketplace.json"),
        "utf8",
      ),
    ) as { name?: unknown };
    return typeof manifest.name === "string" && manifest.name.trim()
      ? manifest.name.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Register the methodology marketplace on this machine from the local clone (a
 * `directory` source — offline, no github). One-shot, idempotent, best-effort:
 * registering enables nothing on its own. Returns whether it ran cleanly.
 */
export async function registerMarketplace(marketplacePath: string): Promise<boolean> {
  try {
    await execFileAsync("claude", ["plugin", "marketplace", "add", marketplacePath]);
    return true;
  } catch {
    return false; // already added, or claude not on PATH — opt-in still works via the bundle
  }
}

/**
 * Opt a single repo in (per-repo, never global): write the portable
 * `enabledPlugins` entry into `<repoPath>/.claude/settings.json`, merged
 * non-clobbering. Reads → pure merge → writes only if changed. Returns whether
 * it wrote.
 */
export async function enableMethodologyPluginForRepo(repoPath: string): Promise<boolean> {
  const dir = path.join(repoPath, ".claude");
  const file = path.join(dir, "settings.json");
  let current: Settings = {};
  try {
    current = JSON.parse(await fs.readFile(file, "utf8")) as Settings;
  } catch {
    current = {}; // missing or unparseable → start from empty
  }
  const { settings, changed } = applyPluginEnablement(current);
  if (!changed) return false;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return true;
}
