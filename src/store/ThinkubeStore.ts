/**
 * ThinkubeStore — the file layer for `.thinkube/*.md`.
 *
 * Owns reading, writing, listing, and change notifications for the
 * methodology files described in §Appendix B:
 *
 *   .thinkube/epics/EP-{n}.md             kind=epic
 *   .thinkube/stories/ST-{n}.md           kind=story
 *   .thinkube/specs/SP-{n}.md             kind=spec
 *   .thinkube/specs/SP-{n}-tasks.md       kind=task-decomposition
 *   .thinkube/decisions/ADR-{n}.md        kind=decision
 *   .thinkube/retros/{YYYY-MM-DD}.md      kind=retro
 *
 * Every method is workspace-rooted: pass the absolute workspace path into
 * the constructor. Multi-root setups should construct one store per root or
 * re-instantiate as the active context changes. The file layer is the
 * source of truth — there's no in-memory copy beyond the issue→path index
 * we maintain for `linkIssueToFile`. That index is rebuilt eagerly on
 * activation and incrementally on watcher events.
 *
 * Write discipline (§7.9): every `writeFile` runs `scanForSecrets` over the
 * body. Matches refuse the write unless the caller passes `allowSecrets:
 * true`, which is reserved for explicit user override. Frontmatter is
 * scanned too — pasting a token there would defeat the safety net.
 *
 * Change events: the public `onChanged` event fires for every observed
 * create/change/delete under `.thinkube/`. We don't dedupe rapid bursts —
 * higher layers debounce if they need to.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  Frontmatter,
  Kind,
  ParsedFile,
  parseFrontmatter,
  SecretMatch,
  scanForSecrets,
  serializeFrontmatter,
} from "./frontmatter";

export type ListableKind = "epic" | "story" | "spec" | "decision" | "retro";

const KIND_TO_DIR: Record<ListableKind, string> = {
  epic: "epics",
  story: "stories",
  spec: "specs",
  decision: "decisions",
  retro: "retros",
};

const KIND_TO_PREFIX: Record<Exclude<ListableKind, "retro">, string> = {
  epic: "EP",
  story: "ST",
  spec: "SP",
  decision: "ADR",
};

export interface WriteOptions {
  /**
   * Allow the write even if `scanForSecrets` finds matches. Reserved for
   * explicit user override (e.g. a "yes, I really mean it" toast). Default
   * false.
   */
  allowSecrets?: boolean;
}

export interface SecretRefusedError extends Error {
  code: "SECRET_REFUSED";
  matches: SecretMatch[];
}

export interface FileChange {
  /** Relative path under `.thinkube/`, e.g. `specs/SP-50.md`. */
  relativePath: string;
  /** Kind inferred from the path, if recognizable. */
  kind?: ListableKind | "task-decomposition";
  type: "created" | "changed" | "deleted";
}

export class ThinkubeStore implements vscode.Disposable {
  private readonly _onChanged = new vscode.EventEmitter<FileChange>();
  readonly onChanged = this._onChanged.event;

  private watcher: vscode.FileSystemWatcher | undefined;
  /** Map: issue number → relative path. Rebuilt on watcher events. */
  private readonly issueIndex = new Map<number, string>();
  private indexBuilt = false;

  constructor(public readonly workspaceRoot: string) {}

  /** Absolute path to the `.thinkube/` directory in this workspace root. */
  get thinkubeDir(): string {
    return path.join(this.workspaceRoot, ".thinkube");
  }

  /** Start watching `.thinkube/**`. Idempotent. */
  activate(): void {
    if (this.watcher) return;
    const pattern = new vscode.RelativePattern(
      this.workspaceRoot,
      ".thinkube/**/*.md",
    );
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidCreate((uri) => this.handleFsEvent(uri, "created"));
    this.watcher.onDidChange((uri) => this.handleFsEvent(uri, "changed"));
    this.watcher.onDidDelete((uri) => this.handleFsEvent(uri, "deleted"));
    // Build the index in the background; callers can await
    // `linkIssueToFile` and it will block on this if needed.
    void this.rebuildIndex();
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    this._onChanged.dispose();
  }

  // ─── Path helpers ───────────────────────────────────────────────────────

  /**
   * Canonical relative path for an issue-backed kind. For retros pass a
   * date string ("2026-05-19"); for decisions pass an ADR number; for
   * issue-backed kinds (epic/story/spec) pass the GitHub issue number.
   */
  pathFor(kind: ListableKind, idOrDate: number | string): string {
    const dir = KIND_TO_DIR[kind];
    if (kind === "retro") {
      const date = typeof idOrDate === "string" ? idOrDate : String(idOrDate);
      return `${dir}/${date}.md`;
    }
    const prefix = KIND_TO_PREFIX[kind];
    return `${dir}/${prefix}-${idOrDate}.md`;
  }

  /** Path to the cc-sdd task-decomposition sibling of a spec. */
  pathForTasks(specIssue: number): string {
    return `${KIND_TO_DIR.spec}/${KIND_TO_PREFIX.spec}-${specIssue}-tasks.md`;
  }

  /**
   * Lookup which `.thinkube/*.md` file extends a given issue number, by
   * scanning the frontmatter index. Returns undefined if no file claims
   * the issue.
   */
  async linkIssueToFile(issue: number): Promise<string | undefined> {
    if (!this.indexBuilt) await this.rebuildIndex();
    return this.issueIndex.get(issue);
  }

  // ─── Read / list ────────────────────────────────────────────────────────

  /**
   * Read a file by relative path (e.g. `specs/SP-50.md`). Returns undefined
   * if missing. Throws on I/O errors other than ENOENT.
   */
  async getFile(relativePath: string): Promise<ParsedFile | undefined> {
    const abs = this.absFor(relativePath);
    let text: string;
    try {
      text = await fs.readFile(abs, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
    return parseFrontmatter(text);
  }

  /** Enumerate all `.md` files under a kind's directory. */
  async listKind(kind: ListableKind): Promise<string[]> {
    const dir = path.join(this.thinkubeDir, KIND_TO_DIR[kind]);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: string[] = [];
    for (const n of names) {
      if (!n.endsWith(".md")) continue;
      // For spec dir, the task-decomposition siblings (`SP-{n}-tasks.md`)
      // are listed separately; exclude them from `listKind('spec')`.
      if (kind === "spec" && /-tasks\.md$/.test(n)) continue;
      out.push(`${KIND_TO_DIR[kind]}/${n}`);
    }
    return out.sort();
  }

  /** Enumerate `SP-{n}-tasks.md` decompositions specifically. */
  async listTaskDecompositions(): Promise<string[]> {
    const dir = path.join(this.thinkubeDir, KIND_TO_DIR.spec);
    try {
      const names = await fs.readdir(dir);
      return names
        .filter((n) => /-tasks\.md$/.test(n))
        .map((n) => `${KIND_TO_DIR.spec}/${n}`)
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  // ─── Write ──────────────────────────────────────────────────────────────

  /**
   * Write a `.thinkube/*.md` file with frontmatter. Runs `scanForSecrets`
   * over both frontmatter and body; matches refuse the write unless
   * `allowSecrets: true`. mkdir's parent directories as needed.
   */
  async writeFile(
    relativePath: string,
    frontmatter: Frontmatter | undefined,
    body: string,
    opts: WriteOptions = {},
  ): Promise<void> {
    const text = serializeFrontmatter({ frontmatter, body });
    if (!opts.allowSecrets) {
      const matches = scanForSecrets(text);
      if (matches.length > 0) {
        const err = new Error(
          `Refusing to write ${relativePath}: detected ${matches.length} potential secret(s) — ${matches.map((m) => m.pattern).join(", ")}. Pass allowSecrets:true to override.`,
        ) as SecretRefusedError;
        err.code = "SECRET_REFUSED";
        err.matches = matches;
        throw err;
      }
    }
    const abs = this.absFor(relativePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text, "utf8");
    // Eagerly update the index — the file watcher fires too, but a
    // subsequent `linkIssueToFile` call in the same tick should see it.
    if (frontmatter?.issue != null && Number.isFinite(frontmatter.issue)) {
      this.issueIndex.set(frontmatter.issue, relativePath);
    }
  }

  // ─── Watching ───────────────────────────────────────────────────────────

  /**
   * Subscribe to changes under `.thinkube/`. When `kind` is given, the
   * callback only fires for that kind (and, for spec, also for
   * task-decomposition siblings). Pass `undefined` to receive everything.
   */
  watch(
    kind: ListableKind | undefined,
    cb: (change: FileChange) => void,
  ): vscode.Disposable {
    return this.onChanged((change) => {
      if (!kind) return cb(change);
      if (kind === "spec" && change.kind === "task-decomposition")
        return cb(change);
      if (change.kind === kind) return cb(change);
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private absFor(relativePath: string): string {
    // Normalize and reject any traversal — relativePath is API-supplied
    // but callers might forward user input.
    const normalized = path.normalize(relativePath).replace(/^[/\\]+/, "");
    if (normalized.startsWith("..")) {
      throw new Error(`Refusing path outside .thinkube/: ${relativePath}`);
    }
    return path.join(this.thinkubeDir, normalized);
  }

  private async rebuildIndex(): Promise<void> {
    this.issueIndex.clear();
    for (const kind of ["epic", "story", "spec"] as const) {
      const files = await this.listKind(kind);
      for (const rel of files) {
        const parsed = await this.getFile(rel);
        const issue = parsed?.frontmatter?.issue;
        if (typeof issue === "number" && Number.isFinite(issue)) {
          this.issueIndex.set(issue, rel);
        }
      }
    }
    this.indexBuilt = true;
  }

  private handleFsEvent(uri: vscode.Uri, type: FileChange["type"]): void {
    const rel = path.relative(this.thinkubeDir, uri.fsPath).replace(/\\/g, "/");
    if (rel.startsWith("..")) return; // out of scope
    const kind = inferKindFromPath(rel);
    this._onChanged.fire({ relativePath: rel, kind, type });
    // Keep the index live for issue-backed kinds.
    void this.refreshIndexEntryFor(rel, type);
  }

  private async refreshIndexEntryFor(
    rel: string,
    type: FileChange["type"],
  ): Promise<void> {
    if (type === "deleted") {
      for (const [issue, p] of this.issueIndex) {
        if (p === rel) this.issueIndex.delete(issue);
      }
      return;
    }
    try {
      const parsed = await this.getFile(rel);
      const issue = parsed?.frontmatter?.issue;
      if (typeof issue === "number" && Number.isFinite(issue)) {
        this.issueIndex.set(issue, rel);
      }
    } catch {
      // ignore — next listKind pass will reconcile
    }
  }
}

function inferKindFromPath(rel: string): FileChange["kind"] {
  if (rel.startsWith(`${KIND_TO_DIR.epic}/`) && rel.endsWith(".md"))
    return "epic";
  if (rel.startsWith(`${KIND_TO_DIR.story}/`) && rel.endsWith(".md"))
    return "story";
  if (rel.startsWith(`${KIND_TO_DIR.spec}/`) && rel.endsWith(".md")) {
    return /-tasks\.md$/.test(rel) ? "task-decomposition" : "spec";
  }
  if (rel.startsWith(`${KIND_TO_DIR.decision}/`) && rel.endsWith(".md"))
    return "decision";
  if (rel.startsWith(`${KIND_TO_DIR.retro}/`) && rel.endsWith(".md"))
    return "retro";
  return undefined;
}

// Re-export the frontmatter types from this module so consumers only import
// from one place when they're working with the store.
export type { Frontmatter, Kind, ParsedFile, SecretMatch } from "./frontmatter";
