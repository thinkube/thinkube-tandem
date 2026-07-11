/**
 * ThinkubeStore — the file layer for the thinking space's markdown files
 * (the sidecar thinking space namespace; co-located `.thinkube/` is deprecated, TEP-0008).
 *
 * Owns reading, writing, listing, and change notifications for the
 * methodology files described in §Appendix B:
 *
 *   .thinkube/epics/EP-{n}.md             kind=epic
 *   .thinkube/stories/ST-{n}.md           kind=story
 *   .thinkube/specs/SP-{n}/spec.md        kind=spec    (Tandem)
 *   .thinkube/specs/SP-{n}/SL-{m}.md      kind=slice   (Tandem, per-Spec numbering)
 *   .thinkube/specs/SP-{n}.md             kind=spec    (legacy flat)
 *   .thinkube/specs/SP-{n}-tasks.md       kind=task-decomposition (legacy)
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
import * as fsSync from "node:fs";
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
import { isRetiredStatus } from "../methodology/sliceLifecycle";

export type ListableKind =
  | "epic"
  | "story"
  | "spec"
  | "tep"
  | "decision"
  | "retro";

const KIND_TO_DIR: Record<ListableKind, string> = {
  epic: "epics",
  story: "stories",
  spec: "specs",
  tep: "teps",
  decision: "decisions",
  retro: "retros",
};

const KIND_TO_PREFIX: Record<Exclude<ListableKind, "retro">, string> = {
  epic: "EP",
  story: "ST",
  spec: "SP",
  tep: "TEP",
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
  kind?: ListableKind | "task-decomposition" | "slice";
  type: "created" | "changed" | "deleted";
}

export class ThinkubeStore implements vscode.Disposable {
  private readonly _onChanged = new vscode.EventEmitter<FileChange>();
  readonly onChanged = this._onChanged.event;

  private watcher: vscode.FileSystemWatcher | undefined;
  /** Map: issue number → relative path. Rebuilt on watcher events. */
  private readonly issueIndex = new Map<number, string>();
  private indexBuilt = false;

  private readonly thinkingSpaceDir: string;

  /**
   * @param workspaceRoot the Thinking Space's git repo root — still used for
   *   provenance / git-coords, which resolve against the code repo.
   * @param thinkingSpaceDir the thinking space directory: the sidecar namespace
   *   (`<thinking space-root>/<namespace>`) that holds specs/teps/decisions/retros.
   *   **Required** — there is no co-located default. Decoupling thinking space-location
   *   from repo-location is the spine of SP-8 / TEP-0008, and a missing
   *   `thinkingSpaceDir` must fail loudly rather than silently re-create the deprecated
   *   co-located `<workspaceRoot>/.thinkube` form.
   */
  constructor(
    public readonly workspaceRoot: string,
    thinkingSpaceDir?: string,
  ) {
    if (!thinkingSpaceDir) {
      throw new Error(
        "ThinkubeStore requires an explicit thinkingSpaceDir (the sidecar thinking space " +
          "namespace). Refusing to fall back to a co-located " +
          "<workspaceRoot>/.thinkube — that form is deprecated (TEP-0008).",
      );
    }
    this.thinkingSpaceDir = thinkingSpaceDir;
  }

  /** Absolute path to the thinking space dir (the sidecar thinking space namespace holding
   * specs/teps/decisions/retros). */
  get thinkubeDir(): string {
    return this.thinkingSpaceDir;
  }

  // ─── Org-scoped tree layout ────────────────────────────────
  // The thinking space stores artifacts as a tree under a per-maintainer org segment:
  //   <org>/teps/TEP-n/tep.md · <org>/teps/TEP-n/SP-m/spec.md · …/SL-k.md
  // The org is discovered (a child dir of the thinking space holding a `teps/`). Cached
  // once found; sync so the path builders stay synchronous.
  private _orgSeg: string | undefined;
  private orgSeg(): string | undefined {
    if (this._orgSeg) return this._orgSeg;
    try {
      for (const e of fsSync.readdirSync(this.thinkingSpaceDir, {
        withFileTypes: true,
      })) {
        if (
          !e.isDirectory() ||
          e.name.startsWith(".") ||
          e.name === "node_modules"
        )
          continue;
        if (fsSync.existsSync(path.join(this.thinkingSpaceDir, e.name, "teps"))) {
          this._orgSeg = e.name;
          return e.name;
        }
      }
    } catch {
      /* thinking space dir missing / unreadable → no org yet */
    }
    return undefined;
  }

  /** Thinking Space-relative `teps` root — `<org>/teps` in the new tree, bare `teps`
   *  for an org-less (empty/uninitialised) thinking space. */
  private tepsRoot(): string {
    const org = this.orgSeg();
    return org ? `${org}/${KIND_TO_DIR.tep}` : KIND_TO_DIR.tep;
  }

  /**
   * Normalize a thinking-space-relative path so a caller may address the org tree
   * WITHOUT knowing the maintainer's org segment. A leading `teps` / `teps/…` is
   * rewritten to `<org>/teps/…` (the org discovered from the tree, same source
   * `tepsRoot` uses). A path that already carries the org (`<org>/teps/…`), or
   * targets a non-org dir (`specs/`, `decisions/`, `retros/`), is returned as-is,
   * as is any path when the thinking space is org-less. This keeps the org
   * invisible plumbing — the same reason `write_spec`/`get_slice` derive it
   * internally — so a raw read like `get_thinkube_file "teps/TEP-6/SP-3/spec.md"`
   * resolves instead of dropping the org and 404-ing.
   */
  resolveOrgRelativePath(relativePath: string): string {
    const rel = relativePath.replace(/^\/+/, "");
    const org = this.orgSeg();
    const tep = KIND_TO_DIR.tep;
    if (!org || org === "") return rel;
    if (rel === tep || rel.startsWith(`${tep}/`)) return `${org}/${rel}`;
    return rel;
  }

  /** Start watching `.thinkube/**`. Idempotent. */
  activate(): void {
    if (this.watcher) return;
    // Watch the thinking space dir directly (it IS the thinking space namespace). Using
    // the thinking space dir as the RelativePattern base lets the watcher fire even when
    // the thinking space lives at a central root outside the code repo (SP-8).
    const pattern = new vscode.RelativePattern(this.thinkingSpaceDir, "**/*.md");
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

  // ─── Tandem: Spec → Slice (nested layout) ───────────────────────────────
  //   .thinkube/specs/SP-{n}/spec.md      the Spec document
  //   .thinkube/specs/SP-{n}/SL-{m}.md    its Slices (numbered per-Spec)

  /** Split a composite spec id, REFUSING any shape that would build a phantom
   *  path. Before this guard, an unresolved ref (e.g. the flat handle
   *  `TEP-1_SP-4` passed through verbatim) silently produced
   *  `teps/TEP-TEP-1_SP-4/SP-undefined/…` — callers must resolve refs through
   *  `refResolver` first; this is the last line of defense, not a parser. */
  private static compositeParts(specNumber: string): [string, string] {
    const [tep, sp, ...rest] = specNumber.split("/");
    if (!tep || !sp || rest.length > 0) {
      throw new Error(
        `Internal: spec id "${specNumber}" is not a composite \`<tep>/<sp>\` — refusing to build a phantom path (resolve refs via refResolver first).`,
      );
    }
    return [tep, sp];
  }

  /** Path to a Spec's document. The spec id is the composite `${tep}/${spec}`
   *  (e.g. `1/2`) → `<org>/teps/TEP-1/SP-2/spec.md`. */
  pathForSpecDoc(specNumber: string): string {
    const [tep, sp] = ThinkubeStore.compositeParts(specNumber);
    return `${this.tepsRoot()}/TEP-${tep}/SP-${sp}/spec.md`;
  }

  /** Path to a Slice file under its parent Spec in the tree. */
  pathForSlice(specNumber: string, sliceNumber: number): string {
    const [tep, sp] = ThinkubeStore.compositeParts(specNumber);
    return `${this.tepsRoot()}/TEP-${tep}/SP-${sp}/SL-${sliceNumber}.md`;
  }

  /** The canonical human handle for a slice — the tep-qualified
   *  `TEP-n_SP-m_SL-k` flattening (the spec id is the composite `${tep}/${spec}`). */
  sliceHandle(specNumber: string, sliceNumber: number): string {
    const [tep, sp] = ThinkubeStore.compositeParts(specNumber);
    return `TEP-${tep}_SP-${sp}_SL-${sliceNumber}`;
  }

  // ─── Tandem: TEPs (flat files, the orthogonal *why* axis — TEP-0009) ──────
  //   .thinkube/teps/TEP-{id}.md      one Tandem Enhancement Proposal per file

  /** Canonical path for a NEW TEP document (slugless). Legacy TEPs may carry a
   *  `-{slug}` suffix in the filename — use `findTep` to resolve those. */
  pathForTep(tepId: string): string {
    // The org-agnostic TEMPLATE scaffold stays at the fixed thinking space-level path.
    if (tepId === "TEMPLATE") return `${KIND_TO_DIR.tep}/TEP-TEMPLATE.md`;
    return `${this.tepsRoot()}/TEP-${tepId}/tep.md`;
  }

  /** Match a TEP filename: `TEP-{id}.md` or legacy `TEP-{id}-{slug}.md`. The id
   *  is the segment after `TEP-` up to the first `-` or `.md`. Excludes the
   *  `TEP-TEMPLATE.md` scaffold. */
  private static readonly TEP_FILE_RE = /^TEP-([A-Za-z0-9]+)(?:-.*)?\.md$/;

  /** TEPs under `teps/` as `{ id, relativePath }`, sorted by id. Tolerates the
   *  legacy `TEP-{id}-{slug}.md` names by returning the real file path (the id
   *  alone can't reconstruct a slugged filename). */
  async listTeps(): Promise<{ id: string; relativePath: string }[]> {
    const root = this.tepsRoot();
    const dir = path.join(this.thinkubeDir, ...root.split("/"));
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: { id: string; relativePath: string }[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const m = /^TEP-([A-Za-z0-9]+)$/.exec(e.name);
      if (m && m[1] !== "TEMPLATE")
        out.push({ id: m[1], relativePath: `${root}/${e.name}/tep.md` });
    }
    return out.sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
  }

  /** Resolve a TEP id to its real file path (slugless or legacy slugged), or
   *  undefined if absent. Used to open the TEP behind a spec's `implements:`. */
  async findTep(tepId: string): Promise<string | undefined> {
    for (const t of await this.listTeps())
      if (t.id === tepId) return t.relativePath;
    return undefined;
  }

  /** Spec ids (the `SP-{id}` folders) under `specs/`, sorted. Ids are opaque
   *  strings (sequential numbers). */
  async listSpecDirs(): Promise<string[]> {
    const root = this.tepsRoot();
    const tepsDir = path.join(this.thinkubeDir, ...root.split("/"));
    let teps: fsSync.Dirent[];
    try {
      teps = await fs.readdir(tepsDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const ids: string[] = [];
    for (const t of teps) {
      const tm = /^TEP-([A-Za-z0-9]+)$/.exec(t.name);
      if (!t.isDirectory() || !tm || tm[1] === "TEMPLATE") continue;
      let specs: fsSync.Dirent[];
      try {
        specs = await fs.readdir(path.join(tepsDir, t.name), {
          withFileTypes: true,
        });
      } catch {
        continue;
      }
      for (const s of specs) {
        const sm = /^SP-([A-Za-z0-9]+)$/.exec(s.name);
        if (s.isDirectory() && sm) ids.push(`${tm[1]}/${sm[1]}`);
      }
    }
    return ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  /**
   * Slice file paths (relative) under one Spec, or across all Specs when
   * `specNumber` is omitted. Includes archived slices (their files are kept).
   */
  async listSlices(specNumber?: string): Promise<string[]> {
    const specs = specNumber != null ? [specNumber] : await this.listSpecDirs();
    const root = this.tepsRoot();
    const out: string[] = [];
    for (const id of specs) {
      const [tep, sp] = id.split("/");
      const dir = path.join(
        this.thinkubeDir,
        ...root.split("/"),
        `TEP-${tep}`,
        `SP-${sp}`,
      );
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      for (const nm of names) {
        if (/^SL-\d+\.md$/.test(nm))
          out.push(`${root}/TEP-${tep}/SP-${sp}/${nm}`);
      }
    }
    return out.sort();
  }

  /**
   * Active (frontier) slice file paths — the subset of {@link listSlices} that
   * is **not** retired. A slice whose frontmatter `status:` is the terminal
   * `retired` token (`sliceLifecycle.RETIRED_STATUS`, read via `isRetiredStatus`
   * — never a re-spelled literal) is dropped here, because a retired slice
   * leaves the active thinking space/frontier (SP-th4wqd_SL-1; the → Done gate never runs
   * for it).
   *
   * This is deliberately distinct from the numbering allocator: a retired slice
   * is excluded from this active set but **still counted** by `listSlices` /
   * {@link nextSliceNumber}, so its `SL-{m}` stays claimed and the next slice is
   * still `max + 1` (number reserved — ADR-0007 "archive, don't delete").
   */
  async listActiveSlices(specNumber?: string): Promise<string[]> {
    const out: string[] = [];
    for (const rel of await this.listSlices(specNumber)) {
      const parsed = await this.getFile(rel);
      const status = parsed?.frontmatter?.status;
      if (typeof status === "string" && isRetiredStatus(status)) continue;
      out.push(rel);
    }
    return out;
  }

  // ── Monotonic number allocators ──
  // Archive-don't-delete keeps every number claimed by a file, so `max + 1`
  // can never reuse a freed number (ADR-0007).

  /** Next SP number under a TEP: highest existing `SP-<n>` + 1 (scan-max+1).
   *  The org segment namespaces per-maintainer, so numbers never collide. */
  async nextSpecNumber(tepNumber: string): Promise<string> {
    const root = this.tepsRoot();
    const dir = path.join(
      this.thinkubeDir,
      ...root.split("/"),
      `TEP-${tepNumber}`,
    );
    let max = 0;
    try {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const m = /^SP-(\d+)$/.exec(e.name);
        if (e.isDirectory() && m) max = Math.max(max, Number(m[1]));
      }
    } catch {
      /* no specs under this TEP yet */
    }
    return String(max + 1);
  }

  /** Next TEP id: highest existing numeric `TEP-<n>` + 1 (scan-max+1). The org
   *  segment namespaces per-maintainer, so sequential numbers never collide
   *  across collaborators. */
  async nextTepId(): Promise<string> {
    let max = 0;
    for (const t of await this.listTeps()) {
      const n = Number(t.id);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return String(max + 1);
  }

  /** Next per-Spec Slice number = highest existing `SL-{m}` under that Spec + 1.
   *  Deliberately reads the **full** {@link listSlices} set, not
   *  {@link listActiveSlices}: a retired slice's file is kept (ADR-0007), so its
   *  number stays claimed and the next slice is `max + 1` — a retired number is
   *  never reused even though the slice has left the active frontier. */
  async nextSliceNumber(specNumber: string): Promise<number> {
    let max = 0;
    for (const rel of await this.listSlices(specNumber)) {
      const m = /SL-(\d+)\.md$/.exec(rel);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
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
    if (/\/SL-\d+\.md$/.test(rel)) return "slice"; // nested Tandem slice
    if (/-tasks\.md$/.test(rel)) return "task-decomposition"; // legacy
    return "spec"; // SP-{n}/spec.md or legacy SP-{n}.md
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
