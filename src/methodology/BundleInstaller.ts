/**
 * BundleInstaller — installs / updates / inspects the Thinkube methodology
 * bundle in a user project's `.claude/` + `.mcp.json` + `CLAUDE.md`.
 *
 * Source of truth: `templates/methodology-bundle/` in the extension. Each
 * file is listed in the bundle's `manifest.json` with a `kind` that
 * dictates how it's installed:
 *
 *   copy             plain file-copy (skills, agents, the simple ones)
 *   settings-merge   merge our permissions allow/deny into the user's
 *                    `.claude/settings.json` (de-duplicating, never
 *                    replacing user entries)
 *   mcp-merge        add our entry to `.mcp.json`'s mcpServers (never
 *                    touch other entries)
 *   claudemd-block   insert / update the delimited methodology block in
 *                    the project's `CLAUDE.md`; idempotent
 *   stamp            record the install metadata (version, install time,
 *                    per-file source hashes) at `.thinkube/.bundle-version.json`
 *                    for drift detection
 *
 * Status model (`getStatus`):
 *
 *   not-installed     no stamp file present
 *   up-to-date        every installed file's hash matches the stamp AND
 *                     every source-file hash matches the stamp
 *   update-available  source hashes differ from stamp (bundle in repo
 *                     advanced beyond what's installed)
 *   locally-modified  installed-file hashes differ from stamp (user
 *                     hand-edited bundle files after install)
 *
 * `diff()` returns the per-file breakdown so the UI can show which file is
 * in which state.
 *
 * `install({strategy})` writes the bundle. `strategy = 'reapply'`
 * overwrites everything; `'merge-modified-only'` skips files the user has
 * modified locally, preserving their edits.
 */
import { promises as fs } from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";

const BUNDLE_SUBDIR = "templates/methodology-bundle";
const STAMP_RELATIVE = ".thinkube/.bundle-version.json";

export type FileKind =
  | "copy"
  | "settings-merge"
  | "mcp-merge"
  | "claudemd-block"
  | "stamp";

export interface ManifestFile {
  source: string;
  target: string;
  kind: FileKind;
}

export interface Manifest {
  version: string;
  files: ManifestFile[];
}

export type BundleStatus =
  | "not-installed"
  | "up-to-date"
  | "update-available"
  | "locally-modified";

export interface FileDiff {
  source: string;
  target: string;
  kind: FileKind;
  state: "missing" | "matches-stamp" | "modified-locally" | "source-changed";
  sourceHash: string;
  installedHash?: string;
  stampHash?: string;
}

export interface StatusReport {
  status: BundleStatus;
  manifestVersion: string;
  stampVersion?: string;
  files: FileDiff[];
}

interface Stamp {
  version: string;
  installedAt: string;
  /** Hashes of the bundle source files at install time (drives "update-available"). */
  sourceHashes: Record<string, string>;
  /** Hashes of what we actually wrote to disk (drives "modified-locally"). */
  installedHashes: Record<string, string>;
}

export interface InstallOptions {
  strategy?: "reapply" | "merge-modified-only";
  /**
   * Non-secret env vars to bake into the `.mcp.json` server entry so the
   * standalone Kanban MCP server knows which repo/board/workspace to operate
   * on when launched by Claude Code (which doesn't inject the env the VS Code
   * provider does). Never put a token here — `.mcp.json` is committed; the
   * server resolves the token itself via `gh auth`.
   */
  mcpEnv?: Record<string, string>;
}

export interface InstallResult {
  workspacePath: string;
  version: string;
  written: string[];
  skipped: Array<{ target: string; reason: string }>;
}

/** Delimited block markers in CLAUDE.md. Must match the literal bundle's CLAUDE.md template. */
const CLAUDEMD_START_RE = /<!--\s*thinkube-methodology:start[^\n]*-->/i;
const CLAUDEMD_END_RE = /<!--\s*thinkube-methodology:end\s*-->/i;

export class BundleInstaller {
  constructor(private readonly extensionPath: string) {}

  private get bundleRoot(): string {
    return path.join(this.extensionPath, BUNDLE_SUBDIR);
  }

  async getManifest(): Promise<Manifest> {
    const raw = await fs.readFile(
      path.join(this.bundleRoot, "manifest.json"),
      "utf8",
    );
    return JSON.parse(raw) as Manifest;
  }

  async getStatus(workspacePath: string): Promise<StatusReport> {
    const manifest = await this.getManifest();
    const stampPath = path.join(workspacePath, STAMP_RELATIVE);
    const stamp = await this.readStamp(stampPath);
    const files: FileDiff[] = [];

    for (const f of manifest.files) {
      if (f.kind === "stamp") continue;
      const srcPath = path.join(this.bundleRoot, f.source);
      const dstPath = path.join(workspacePath, f.target);
      const sourceHash = await this.hashFile(srcPath);
      const installedHash = await this.hashFileIfExists(dstPath);
      const stampInstalled = stamp?.installedHashes[f.source];
      const stampSource = stamp?.sourceHashes[f.source];

      let state: FileDiff["state"];
      if (!stamp) {
        state = "missing";
      } else if (installedHash === undefined) {
        state = "missing";
      } else if (stampInstalled && installedHash !== stampInstalled) {
        state = "modified-locally";
      } else if (stampSource && sourceHash !== stampSource) {
        state = "source-changed";
      } else {
        state = "matches-stamp";
      }
      files.push({
        source: f.source,
        target: f.target,
        kind: f.kind,
        state,
        sourceHash,
        installedHash,
        stampHash: stampInstalled,
      });
    }

    let status: BundleStatus;
    if (!stamp) {
      status = "not-installed";
    } else if (
      files.some((f) => f.state === "modified-locally" || f.state === "missing")
    ) {
      status = "locally-modified";
    } else if (files.some((f) => f.state === "source-changed")) {
      status = "update-available";
    } else {
      status = "up-to-date";
    }

    return {
      status,
      manifestVersion: manifest.version,
      stampVersion: stamp?.version,
      files,
    };
  }

  async install(
    workspacePath: string,
    opts: InstallOptions = {},
  ): Promise<InstallResult> {
    const strategy = opts.strategy ?? "reapply";
    const manifest = await this.getManifest();
    const result: InstallResult = {
      workspacePath,
      version: manifest.version,
      written: [],
      skipped: [],
    };

    // Compute the source-side hash table; used in the stamp and to decide
    // skips under "merge-modified-only".
    const sourceHashes: Record<string, string> = {};
    for (const f of manifest.files) {
      if (f.kind === "stamp") continue;
      sourceHashes[f.source] = await this.hashFile(
        path.join(this.bundleRoot, f.source),
      );
    }

    const stampPath = path.join(workspacePath, STAMP_RELATIVE);
    const existingStamp = await this.readStamp(stampPath);
    const installedHashes: Record<string, string> = {};

    for (const f of manifest.files) {
      if (f.kind === "stamp") continue;
      const dstPath = path.join(workspacePath, f.target);

      if (strategy === "merge-modified-only" && existingStamp) {
        const currentHash = await this.hashFileIfExists(dstPath);
        const stampInstalled = existingStamp.installedHashes[f.source];
        if (
          currentHash !== undefined &&
          stampInstalled &&
          currentHash !== stampInstalled
        ) {
          result.skipped.push({
            target: f.target,
            reason: "locally modified",
          });
          // Preserve the previous stamp entry so the file stays "matches-stamp"
          // until the user explicitly reapplies.
          installedHashes[f.source] = stampInstalled;
          continue;
        }
      }

      try {
        switch (f.kind) {
          case "copy":
            await this.installCopy(f, workspacePath);
            break;
          case "settings-merge":
            await this.installSettingsMerge(f, workspacePath);
            break;
          case "mcp-merge":
            await this.installMcpMerge(f, workspacePath, opts.mcpEnv);
            break;
          case "claudemd-block":
            await this.installClaudeMdBlock(f, workspacePath);
            break;
        }
        // Record the hash of what we actually wrote — installCopy may have
        // inserted a frontmatter stamp, merges produce a synthesised blob,
        // etc. So we hash post-write rather than reusing the source hash.
        const writtenHash = await this.hashFileIfExists(dstPath);
        if (writtenHash !== undefined) {
          installedHashes[f.source] = writtenHash;
        }
        result.written.push(f.target);
      } catch (err) {
        result.skipped.push({
          target: f.target,
          reason: `${f.kind} failed: ${(err as Error).message}`,
        });
      }
    }

    // Write the stamp last so a partial install doesn't claim success.
    const stamp: Stamp = {
      version: manifest.version,
      installedAt: new Date().toISOString(),
      sourceHashes,
      installedHashes,
    };
    await fs.mkdir(path.dirname(stampPath), { recursive: true });
    await fs.writeFile(
      stampPath,
      JSON.stringify(stamp, null, 2) + "\n",
      "utf8",
    );

    return result;
  }

  async diff(workspacePath: string): Promise<FileDiff[]> {
    return (await this.getStatus(workspacePath)).files;
  }

  // ─── File-kind install handlers ─────────────────────────────────────────

  private async installCopy(
    f: ManifestFile,
    workspacePath: string,
  ): Promise<void> {
    const src = path.join(this.bundleRoot, f.source);
    const dst = path.join(workspacePath, f.target);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const content = await fs.readFile(src, "utf8");
    const stamped = this.stampBundleFrontmatter(content);
    await fs.writeFile(dst, stamped, "utf8");
  }

  private async installSettingsMerge(
    f: ManifestFile,
    workspacePath: string,
  ): Promise<void> {
    const src = JSON.parse(
      await fs.readFile(path.join(this.bundleRoot, f.source), "utf8"),
    ) as { permissions?: { allow?: string[]; deny?: string[] } };
    const dst = path.join(workspacePath, f.target);
    const existing = await this.readJsonIfExists(dst);
    const merged = { ...existing };
    const perms = (merged.permissions ??= {}) as {
      allow?: string[];
      deny?: string[];
    };
    perms.allow = unionStrings(perms.allow ?? [], src.permissions?.allow ?? []);
    perms.deny = unionStrings(perms.deny ?? [], src.permissions?.deny ?? []);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, JSON.stringify(merged, null, 2) + "\n", "utf8");
  }

  private async installMcpMerge(
    f: ManifestFile,
    workspacePath: string,
    mcpEnv?: Record<string, string>,
  ): Promise<void> {
    const src = JSON.parse(
      await fs.readFile(path.join(this.bundleRoot, f.source), "utf8"),
    ) as { mcpServers?: Record<string, unknown> };
    const dst = path.join(workspacePath, f.target);
    const existing = await this.readJsonIfExists(dst);
    const merged = { ...existing };
    const servers = (merged.mcpServers ??= {}) as Record<string, unknown>;
    for (const [name, def] of Object.entries(src.mcpServers ?? {})) {
      // Resolve `${extensionPath}` to the real install dir. Claude Code reads
      // `.mcp.json` directly and does NOT expand this placeholder, so without
      // substitution it spawns a nonexistent path and the server never starts.
      const resolved = this.resolveExtensionPath(def) as {
        env?: Record<string, string>;
        [k: string]: unknown;
      };
      // Bake in the repo/board/workspace env so the server isn't launched
      // blind. Claude Code doesn't inject the env the VS Code provider does.
      if (mcpEnv && Object.keys(mcpEnv).length > 0) {
        resolved.env = { ...(resolved.env ?? {}), ...mcpEnv };
      }
      servers[name] = resolved;
    }
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, JSON.stringify(merged, null, 2) + "\n", "utf8");
  }

  /**
   * Recursively replace `${extensionPath}` with the real install dir anywhere
   * it appears in an MCP server definition (command, args, env). Operates on
   * the parsed object — not the JSON string — so paths with special characters
   * never break JSON escaping.
   */
  private resolveExtensionPath(value: unknown): unknown {
    if (typeof value === "string") {
      return value.replace(/\$\{extensionPath\}/g, () => this.extensionPath);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.resolveExtensionPath(v));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          this.resolveExtensionPath(v),
        ]),
      );
    }
    return value;
  }

  private async installClaudeMdBlock(
    f: ManifestFile,
    workspacePath: string,
  ): Promise<void> {
    const src = await fs.readFile(path.join(this.bundleRoot, f.source), "utf8");
    const dst = path.join(workspacePath, f.target);
    let existing = "";
    try {
      existing = await fs.readFile(dst, "utf8");
    } catch {
      existing = "";
    }
    const blockStart = src.match(CLAUDEMD_START_RE);
    const blockEnd = src.match(CLAUDEMD_END_RE);
    if (!blockStart || !blockEnd) {
      throw new Error(
        "bundle CLAUDE.md is missing the thinkube-methodology start/end markers",
      );
    }
    const blockText = src.trim() + "\n";

    const existingStart = existing.match(CLAUDEMD_START_RE);
    const existingEnd = existing.match(CLAUDEMD_END_RE);
    let merged: string;
    if (
      existingStart &&
      existingEnd &&
      existingEnd.index! > existingStart.index!
    ) {
      // Replace the existing block in place.
      const before = existing.slice(0, existingStart.index!);
      const after = existing.slice(existingEnd.index! + existingEnd[0].length);
      merged = `${before}${blockText.trimEnd()}\n${after}`;
    } else if (existing.trim().length === 0) {
      merged = blockText;
    } else {
      merged = `${existing.trimEnd()}\n\n${blockText}`;
    }
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, merged, "utf8");
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Add a `thinkube-bundle: <version>` line to a markdown file's frontmatter
   * so future drift-detection / un-install passes can identify our files
   * even if the user moves them. No-op for files without YAML frontmatter
   * or with the stamp already present.
   */
  private stampBundleFrontmatter(content: string): string {
    // Already present? Leave it.
    if (/^thinkube-bundle:\s/im.test(content.slice(0, 4096))) return content;
    const fmStart = content.indexOf("---");
    if (fmStart !== 0) return content; // no frontmatter; don't synthesize one
    const fmEnd = content.indexOf("\n---", 3);
    if (fmEnd < 0) return content;
    const stampLine = "thinkube-bundle: 0.0.1\n";
    return content.slice(0, fmEnd + 1) + stampLine + content.slice(fmEnd + 1);
  }

  private async readStamp(stampPath: string): Promise<Stamp | undefined> {
    try {
      const raw = await fs.readFile(stampPath, "utf8");
      return JSON.parse(raw) as Stamp;
    } catch {
      return undefined;
    }
  }

  private async readJsonIfExists(p: string): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(p, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async hashFile(p: string): Promise<string> {
    const buf = await fs.readFile(p);
    return crypto.createHash("sha256").update(buf).digest("hex");
  }

  private async hashFileIfExists(p: string): Promise<string | undefined> {
    try {
      return await this.hashFile(p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }
}

function unionStrings(a: string[], b: string[]): string[] {
  const set = new Set<string>([...a, ...b]);
  return Array.from(set);
}

/**
 * Helper for callers that want a single human-readable summary line.
 */
export function summarizeStatus(report: StatusReport): string {
  switch (report.status) {
    case "not-installed":
      return `Bundle v${report.manifestVersion} not installed.`;
    case "up-to-date":
      return `Bundle v${report.manifestVersion} installed and up-to-date.`;
    case "update-available":
      return `Bundle update available: installed v${report.stampVersion ?? "?"} → source v${report.manifestVersion}.`;
    case "locally-modified": {
      const modified = report.files.filter(
        (f) => f.state === "modified-locally",
      ).length;
      const missing = report.files.filter((f) => f.state === "missing").length;
      const parts: string[] = [];
      if (modified > 0) parts.push(`${modified} locally modified`);
      if (missing > 0) parts.push(`${missing} missing`);
      return `Bundle v${report.stampVersion ?? "?"} installed; ${parts.join(", ")}.`;
    }
  }
}
