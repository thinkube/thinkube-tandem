#!/usr/bin/env node
// MUST be the first import: installs the require-hook that redirects
// `require('vscode')` to our subprocess stub. See `installVscodeStub.ts`.
import "./installVscodeStub";

/**
 * Stdio MCP server for the Thinkube methodology kanban (files-first / Tandem).
 *
 * Board-independent (ADR-0007 Phase-6 decision): ONE server serves every
 * enabled board. Each tool takes an optional `board` parameter resolved per
 * call, so a session can work across boards and a board enabled mid-session
 * is immediately addressable — no relaunch. When `board` is omitted the
 * session's own repo is used (the repo containing this process's cwd; Claude
 * Code spawns `.mcp.json` servers with the session's cwd).
 *
 * Board addressing: the canonical id is the repo's HOME-RELATIVE path
 * (e.g. `apps/vllm`, `thinkube-platform/core/thinkube`). The workspace
 * organization is semantic, so bare basenames are systemically ambiguous
 * (template vs deployed app) and are NEVER resolved — an unknown id fails
 * with candidate suggestions, and `list_boards` supplies the vocabulary.
 * Absolute paths are also accepted.
 *
 * Source of truth: the committed `.thinkube/specs/SP-{n}/SL-{m}.md` slice
 * files (and the parent `SP-{n}/spec.md` documents). There is NO GitHub here —
 * this server reads and writes only through `ThinkubeStore` and projects the
 * board with the same pure `sliceBoard.ts` logic the panel uses, so the MCP
 * surface and the kanban panel always agree.
 *
 * State plumbing: this is a separate Node process, so settings come in via
 * environment variables (baked into `.mcp.json` by the bundle installer, or
 * injected by the VS Code provider):
 *
 *   THINKUBE_ROOTS            path-delimiter-separated directories scanned
 *                             for boards (repos containing `.thinkube/`).
 *                             Optional — defaults to the session's own repo.
 *   THINKUBE_ALLOW_AI_WRITES  "true" | "false" — gates every mutating tool.
 *                             One global flag: solo platform, git is the undo
 *                             (ADR-0007 Phase-6 decision).
 *   THINKUBE_WORKSPACE        legacy single-board binding; honoured as a
 *                             fallback root / default board so `.mcp.json`
 *                             files from older bundle installs keep working.
 *
 * Logging: stderr only. VS Code captures it under the MCP server's output
 * channel; never print to stdout — that channel is the protocol stream.
 */
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { requirementHash } from "../methodology/specChange";
import { gateSliceSatisfiesToDone } from "../methodology/qualityGates";
import { ThinkubeStore } from "../store/ThinkubeStore";
import type { Frontmatter } from "../store/frontmatter";
import { stampOnEnteringDone } from "../github/sliceProvenance";
import { linkedWorktreeInfo } from "../services/WorktreeService";
import {
  buildSliceBoard,
  SliceInput,
  sliceHandle,
} from "../views/kanban/host/storage/sliceBoard";

interface ServerEnv {
  roots: string[];
  allowAIWrites: boolean;
  legacyWorkspace?: string;
}

function readEnv(): ServerEnv {
  const roots = (process.env.THINKUBE_ROOTS ?? "")
    .split(path.delimiter)
    .map((r) => r.trim())
    .filter(Boolean);
  const legacyWorkspace = (process.env.THINKUBE_WORKSPACE ?? "").trim();
  const allowAIWrites =
    (process.env.THINKUBE_ALLOW_AI_WRITES ?? "true").toLowerCase() === "true";
  return {
    roots,
    allowAIWrites,
    legacyWorkspace: legacyWorkspace || undefined,
  };
}

function log(msg: string): void {
  process.stderr.write(`[thinkube-mcp] ${msg}\n`);
}

async function main(): Promise<void> {
  const env = readEnv();
  const boards = new BoardRegistry(env);
  log(
    `booting: roots=[${env.roots.join(", ")}] writes=${env.allowAIWrites} cwd=${process.cwd()} defaultBoard=${boards.defaultBoardPath ?? "(none)"}`,
  );

  // Dynamic import: the MCP SDK is ESM-only, this entrypoint is CJS.
  const sdkServer: any =
    await import("@modelcontextprotocol/sdk/server/index.js");
  const sdkStdio: any =
    await import("@modelcontextprotocol/sdk/server/stdio.js");
  const sdkTypes: any = await import("@modelcontextprotocol/sdk/types.js");

  const server = new sdkServer.Server(
    { name: "thinkube-kanban", version: "0.2.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  const ctx: HandlerContext = { env, boards };
  registerHandlers(server, sdkTypes, ctx);

  const transport = new sdkStdio.StdioServerTransport();
  await server.connect(transport);
  log("connected");
}

// ─── Board registry ─────────────────────────────────────────────────────────

export interface BoardInfo {
  /** Canonical id: home-relative path (absolute when outside $HOME). */
  id: string;
  /** Basename — display only, never an address. */
  name: string;
  /** Absolute repo path. */
  path: string;
}

const DISCOVERY_TTL_MS = 10_000;
const MAX_WALK_DEPTH = 3;

/**
 * Discovers boards (repos with a committed `.thinkube/`) under the configured
 * roots and resolves `board` arguments to `ThinkubeStore`s. Discovery mirrors
 * the navigator's `discoverRepos`: a directory containing `.git` is a repo
 * and a leaf; it is a board iff it also contains `.thinkube/`.
 */
export class BoardRegistry {
  /** The session's own board: the enabled repo containing process.cwd(). */
  readonly defaultBoardPath: string | undefined;

  private readonly roots: string[];
  private readonly stores = new Map<string, ThinkubeStore>();
  private discovered: BoardInfo[] | undefined;
  private discoveredAt = 0;

  constructor(env: ServerEnv) {
    this.defaultBoardPath =
      findEnclosingBoard(process.cwd()) ??
      (env.legacyWorkspace && isBoard(env.legacyWorkspace)
        ? env.legacyWorkspace
        : undefined);
    const roots = [...env.roots];
    // Always be able to discover at least the session's own board (and the
    // legacy workspace, until its .mcp.json is re-installed with roots).
    if (this.defaultBoardPath) roots.push(this.defaultBoardPath);
    if (env.legacyWorkspace) roots.push(env.legacyWorkspace);
    this.roots = [...new Set(roots)];
  }

  list(forceRefresh = false): BoardInfo[] {
    const now = Date.now();
    if (
      !this.discovered ||
      forceRefresh ||
      now - this.discoveredAt > DISCOVERY_TTL_MS
    ) {
      const found = new Map<string, BoardInfo>();
      for (const root of this.roots) {
        walkForBoards(root, 0, found);
      }
      this.discovered = [...found.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      this.discoveredAt = now;
    }
    return this.discovered;
  }

  /**
   * Resolve a `board` argument to a store. Omitted → the session's own
   * board. Canonical id or absolute path → that board. Anything else —
   * including a bare basename, even a currently-unique one — fails with
   * candidate suggestions ("currently unique" is one deploy away from
   * ambiguous).
   */
  resolve(boardArg: string | undefined): ThinkubeStore {
    if (boardArg === undefined || boardArg.trim() === "") {
      if (!this.defaultBoardPath) {
        throw new Error(
          "No default board: this session's cwd is not inside a repo with a committed .thinkube/. Pass `board` explicitly — call list_boards for the available ids.",
        );
      }
      return this.storeFor(this.defaultBoardPath);
    }

    const arg = boardArg.trim();
    if (path.isAbsolute(arg)) {
      if (!isBoard(arg)) {
        throw new Error(
          `"${arg}" is not a board — no committed .thinkube/ directory there.`,
        );
      }
      return this.storeFor(arg);
    }

    const boards = this.list();
    const exact = boards.find((b) => b.id === normalizeId(arg));
    if (exact) return this.storeFor(exact.path);

    // Never resolve fuzzy/basename matches — suggest instead.
    const needle = arg.toLowerCase();
    const candidates = boards
      .filter(
        (b) =>
          b.name.toLowerCase() === needle ||
          b.id.toLowerCase().includes(needle),
      )
      .map((b) => b.id);
    const hint =
      candidates.length > 0
        ? ` Did you mean: ${candidates.join(", ")}?`
        : " Call list_boards for the available ids.";
    throw new Error(
      `Unknown board "${arg}" — boards are addressed by their home-relative id (e.g. thinkube-platform/core/thinkube), never by bare name.${hint}`,
    );
  }

  defaultBoardId(): string | undefined {
    return this.defaultBoardPath ? boardId(this.defaultBoardPath) : undefined;
  }

  private storeFor(absPath: string): ThinkubeStore {
    let store = this.stores.get(absPath);
    if (!store) {
      store = new ThinkubeStore(absPath);
      this.stores.set(absPath, store);
    }
    return store;
  }
}

function isBoard(dir: string): boolean {
  try {
    return fsSync.statSync(path.join(dir, ".thinkube")).isDirectory();
  } catch {
    return false;
  }
}

/** Walk up from `start` to the enclosing repo with a committed .thinkube/. */
function findEnclosingBoard(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (isBoard(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Canonical board id: home-relative path (forward slashes), else absolute. */
function boardId(absPath: string): string {
  const rel = path.relative(os.homedir(), absPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return absPath;
  return rel.split(path.sep).join("/");
}

function normalizeId(id: string): string {
  return id.replace(/\\/g, "/").replace(/\/+$/, "");
}

function walkForBoards(
  dir: string,
  depth: number,
  out: Map<string, BoardInfo>,
): void {
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const isRepo = entries.some((e) => e.isDirectory() && e.name === ".git");
  if (isRepo || isBoard(dir)) {
    if (isBoard(dir)) {
      const abs = path.resolve(dir);
      // A linked worktree (SP-5) is still addressable by its path (id), but it
      // displays as a worktree of its canonical repo — not a rogue board named
      // by its bare directory basename.
      const wt = linkedWorktreeInfo(abs);
      const name = wt
        ? `${path.basename(wt.canonicalRepo)} · ${wt.name} worktree`
        : path.basename(abs);
      out.set(abs, { id: boardId(abs), name, path: abs });
    }
    return; // a repo is a leaf — no nested boards
  }
  if (depth >= MAX_WALK_DEPTH) return;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    walkForBoards(path.join(dir, e.name), depth + 1, out);
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

interface HandlerContext {
  env: ServerEnv;
  boards: BoardRegistry;
}

function registerHandlers(server: any, types: any, ctx: HandlerContext): void {
  const writeGate = (toolName: string) => {
    if (!ctx.env.allowAIWrites) {
      throw new Error(
        `Tool "${toolName}" requires \`thinkube.kanban.allowAIWrites\` to be true (navigator mode is read-only).`,
      );
    }
  };

  server.setRequestHandler(types.ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }));

  server.setRequestHandler(types.CallToolRequestSchema, async (req: any) => {
    const name = req.params.name as string;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await dispatchTool(name, args, ctx, writeGate);
      return {
        content: [
          {
            type: "text",
            text:
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `${name} failed: ${(err as Error).message}`,
          },
        ],
      };
    }
  });

  server.setRequestHandler(types.ListResourcesRequestSchema, async () => ({
    resources: RESOURCE_DEFS,
  }));

  server.setRequestHandler(
    types.ReadResourceRequestSchema,
    async (req: any) => {
      const uri = req.params.uri as string;
      const text = await readResource(uri, ctx);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text,
          },
        ],
      };
    },
  );
}

// ─── Tool definitions + dispatcher ──────────────────────────────────────────

/**
 * The optional `board` parameter shared by every board-scoped tool.
 */
const BOARD_PARAM = {
  board: {
    type: "string",
    description:
      "Board id — the repo's home-relative path (e.g. `thinkube-platform/core/thinkube`), or an absolute path. Omit for the current session's own board. Bare repo names are not accepted (ambiguous: the workspace layout is semantic) — call `list_boards` for the ids.",
  },
} as const;

const TOOL_DEFS = [
  {
    name: "list_boards",
    description:
      "Discover every Tandem board: repos with a committed `.thinkube/` across the configured roots. Returns each board's canonical id (home-relative path — the value to pass as `board` to the other tools), name, and absolute path, plus which board is this session's default. The semantic location is part of the id (`apps/…` = deployed app, `user-templates/…` = template, `thinkube-platform/…` = platform code).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_board",
    description:
      "Current Tandem board, projected from the committed `.thinkube/specs/SP-{n}/SL-{m}.md` slice files. Returns the Ready / Doing / Done columns; each card carries its slice handle (`id`, e.g. `SP-3_SL-42`), title (`description`), and `specStale` / `specChange` (whether the parent Spec's requirements changed since the slice was last verified).",
    inputSchema: {
      type: "object",
      properties: { ...BOARD_PARAM },
      additionalProperties: false,
    },
  },
  {
    name: "get_slice",
    description:
      "Read one slice file. Returns its handle, relative path, frontmatter, and body.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description: "Slice handle, e.g. `SP-3_SL-42`.",
        },
        ...BOARD_PARAM,
      },
      required: ["slice"],
      additionalProperties: false,
    },
  },
  {
    name: "get_thinkube_file",
    description:
      "Read a specific `.thinkube/*.md` file (frontmatter + body). Path is relative to `.thinkube/`.",
    inputSchema: {
      type: "object",
      properties: {
        relative_path: { type: "string", description: "e.g. specs/SP-50.md" },
        ...BOARD_PARAM,
      },
      required: ["relative_path"],
      additionalProperties: false,
    },
  },
  {
    name: "move_slice",
    description:
      "Move a slice to a different column by setting its `status:` frontmatter. Status must be one of: Ready, Doing, Done. Moving to Done is REFUSED unless every acceptance criterion the slice lists in `satisfies` is checked on the parent Spec (the error names the offending criterion); slices with no `satisfies` are not gated. On a successful Done it stamps the slice's `verified_req_hash` from the parent Spec so a later requirement edit re-flags it stale.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description: "Slice handle, e.g. `SP-3_SL-42`.",
        },
        status: {
          type: "string",
          enum: ["Ready", "Doing", "Done"],
        },
        ...BOARD_PARAM,
      },
      required: ["slice", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "create_slice",
    description:
      "Create a new slice under a Spec in the canonical shape. The server allocates the SL number (per-Spec, archive-aware) and serializes the file (frontmatter + `# title` heading + detail body) — callers never pick numbers or format files. Refused when the parent Spec is missing or has an empty `## Acceptance Criteria` (the → Ready gate, enforced at creation). Title limit: 70 chars — detail belongs in the body.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "number",
          description:
            "Parent Spec number {n} (the SP-{n} this slice belongs to).",
        },
        title: {
          type: "string",
          description:
            "The concrete capability delivered, ≤ 70 chars — becomes the card title.",
        },
        body: {
          type: "string",
          description:
            '2–4 lines of detail: what the coherent end-to-end cut includes and what the observable "done" looks like.',
        },
        depends_on: {
          type: "array",
          items: { type: "string" },
          description:
            'Full slice handles this depends on, e.g. ["SP-4_SL-1"].',
        },
        parallel: {
          type: "boolean",
          description:
            "Shares no files/state with sibling slices (parallel-eligible).",
        },
        satisfies: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          description:
            "1-based AC ordinals this slice delivers (positions in the parent Spec's `## Acceptance Criteria`). Arms the → Done gate: the slice can't reach Done until each listed criterion is checked on the Spec.",
        },
        priority: {
          type: "string",
          enum: ["P0", "P1", "P2", "P3"],
        },
        ...BOARD_PARAM,
      },
      required: ["spec", "title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "update_slice",
    description:
      "Replace a slice's markdown body (frontmatter is preserved). The body's first line must be the `# title` heading; if the new body lacks one, the existing title is re-attached and the input is treated as detail — a card can never become heading-less through this tool.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description: "Slice handle, e.g. `SP-3_SL-42`.",
        },
        body: { type: "string" },
        ...BOARD_PARAM,
      },
      required: ["slice", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "write_decision",
    description:
      "Append a new ADR at `.thinkube/decisions/ADR-{n}.md` (n is auto-incremented).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        ...BOARD_PARAM,
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "write_retro_note",
    description:
      "Append a retro note to today's `.thinkube/retros/{YYYY-MM-DD}.md`.",
    inputSchema: {
      type: "object",
      properties: { body: { type: "string" }, ...BOARD_PARAM },
      required: ["body"],
      additionalProperties: false,
    },
  },
];

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
  writeGate: (n: string) => void,
): Promise<unknown> {
  if (name === "list_boards") return listBoards(ctx);

  // Every other tool is board-scoped: resolve the store per call.
  const store = ctx.boards.resolve(optString(args, "board"));
  switch (name) {
    case "list_board":
      return listBoard(store);
    case "get_slice":
      return getSlice(store, asString(args, "slice"));
    case "get_thinkube_file":
      return getThinkubeFile(store, asString(args, "relative_path"));
    case "move_slice":
      writeGate(name);
      return moveSlice(
        store,
        asString(args, "slice"),
        asString(args, "status"),
      );
    case "create_slice":
      writeGate(name);
      return createSlice(store, {
        spec: asNumber(args, "spec"),
        title: asString(args, "title"),
        body: asString(args, "body"),
        depends_on: optStringArray(args, "depends_on"),
        parallel: optBoolean(args, "parallel"),
        satisfies: optNumberArray(args, "satisfies"),
        priority: optString(args, "priority"),
      });
    case "update_slice":
      writeGate(name);
      return updateSlice(
        store,
        asString(args, "slice"),
        asString(args, "body"),
      );
    case "write_decision":
      writeGate(name);
      return writeDecision(
        store,
        asString(args, "title"),
        asString(args, "body"),
      );
    case "write_retro_note":
      writeGate(name);
      return writeRetroNote(store, asString(args, "body"));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ─── Tool implementations ───────────────────────────────────────────────────

const SLICE_PATH_RE = /specs\/SP-(\d+)\/SL-(\d+)\.md$/;
const SLICE_HANDLE_RE = /^SP-(\d+)_SL-(\d+)$/;
const VALID_STATUSES = ["ready", "doing", "done"] as const;

function listBoards(ctx: HandlerContext): unknown {
  return {
    defaultBoard: ctx.boards.defaultBoardId() ?? null,
    boards: ctx.boards.list(true).map((b) => ({
      id: b.id,
      name: b.name,
      path: b.path,
    })),
  };
}

/** Parse a slice handle (`SP-3_SL-42`) → its (spec, slice) numbers. */
function parseSliceHandle(handle: string): {
  specNumber: number;
  sliceNumber: number;
} {
  const m = SLICE_HANDLE_RE.exec(handle.trim());
  if (!m) {
    throw new Error(
      `Invalid slice handle "${handle}" — expected the form SP-{n}_SL-{m}.`,
    );
  }
  return { specNumber: Number(m[1]), sliceNumber: Number(m[2]) };
}

/**
 * Card title = the slice body's first non-empty line (heading marker
 * stripped), clipped for display — legacy one-paragraph slices otherwise
 * leak a whole paragraph into the title. The file keeps the full text.
 */
function sliceTitle(body: string | undefined, fallback: string): string {
  if (!body) return fallback;
  for (const line of body.split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, "").trim();
    if (t) {
      if (t.length <= 80) return t;
      const cut = t.slice(0, 80);
      const at = cut.lastIndexOf(" ");
      return `${at > 40 ? cut.slice(0, at) : cut}…`;
    }
  }
  return fallback;
}

/**
 * Project the committed slice files into the Tandem board. Mirrors
 * `ThinkubeFilesAdapter.load()`'s read loop (we don't instantiate the adapter —
 * it builds a vscode EventEmitter, and this subprocess only has a vscode stub).
 */
async function listBoard(store: ThinkubeStore): Promise<unknown> {
  // Per-Spec requirement-hash, computed once per Spec (specs are few).
  const reqHashBySpec = new Map<number, string>();
  for (const specNumber of await store.listSpecDirs()) {
    const doc = await store.getFile(store.pathForSpecDoc(specNumber));
    if (doc?.body) reqHashBySpec.set(specNumber, requirementHash(doc.body));
  }

  const inputs: SliceInput[] = [];
  for (const rel of await store.listSlices()) {
    const m = SLICE_PATH_RE.exec(rel);
    if (!m) continue;
    const specNumber = Number(m[1]);
    const sliceNumber = Number(m[2]);
    const parsed = await store.getFile(rel);
    const fm: Frontmatter = parsed?.frontmatter ?? {};
    inputs.push({
      specNumber,
      sliceNumber,
      title: sliceTitle(parsed?.body, sliceHandle(specNumber, sliceNumber)),
      body: parsed?.body,
      status: fm.status,
      due: fm.due,
      priority: fm.priority,
      stampedReqHash: fm.verified_req_hash,
      currentReqHash: reqHashBySpec.get(specNumber),
    });
  }

  // Scope = the board's canonical id, so cross-board output is unambiguous.
  const scope = boardId(store.workspaceRoot);
  const board = buildSliceBoard(inputs, scope);

  const columns = board.columns.map((col) => ({
    id: col.id,
    title: col.title,
    cards: col.tasksIds.map((id) => {
      const card = board.tasks[id];
      return {
        id: card.id,
        description: card.description,
        specStale: card.specStale,
        specChange: card.specChange,
        priority: card.priority,
        due: card.dueDate,
      };
    }),
  }));

  return { scope: board.scope, columns };
}

async function getSlice(
  store: ThinkubeStore,
  handle: string,
): Promise<unknown> {
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at .thinkube/${rel}`);
  return {
    handle: store.sliceHandle(specNumber, sliceNumber),
    relativePath: rel,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}

async function getThinkubeFile(
  store: ThinkubeStore,
  relativePath: string,
): Promise<unknown> {
  const parsed = await store.getFile(relativePath);
  if (!parsed) throw new Error(`No file at .thinkube/${relativePath}`);
  return { relativePath, frontmatter: parsed.frontmatter, body: parsed.body };
}

async function moveSlice(
  store: ThinkubeStore,
  handle: string,
  status: string,
): Promise<unknown> {
  const target = status.trim().toLowerCase() as (typeof VALID_STATUSES)[number];
  if (!VALID_STATUSES.includes(target)) {
    throw new Error(
      `Invalid status "${status}" — expected one of Ready, Doing, Done.`,
    );
  }
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at .thinkube/${rel}`);

  const fm: Frontmatter = { ...(parsed.frontmatter ?? {}), status: target };

  let baselineStamped = false;
  let gateSkipped: string | undefined;
  if (target === "done") {
    // Read the parent Spec once — both the → Done gate and the baseline stamp
    // need its body. A read failure leaves `specBody` undefined; the gate then
    // sees zero criteria and refuses any slice that claims to satisfy one
    // (fail-closed for integrity), while ungated legacy slices still pass.
    let specBody: string | undefined;
    try {
      const doc = await store.getFile(store.pathForSpecDoc(specNumber));
      specBody = doc?.body;
    } catch (err) {
      process.stderr.write(
        `[thinkube-mcp] move_slice: reading parent Spec for ${handle} failed: ${(err as Error).message}\n`,
      );
    }

    // → Done gate (SP-6, mechanical half): the slice may enter Done only once
    // every AC it claims to satisfy is checked on the parent Spec. On refusal
    // we throw BEFORE any write — nothing is mutated and the error names the
    // offending criterion.
    const gate = gateSliceSatisfiesToDone({
      specBody,
      satisfies: parsed.frontmatter?.satisfies,
    });
    if (!gate.ok) throw new Error(gate.reason);
    gateSkipped = gate.gateSkipped;

    // Stamp the verification baseline so a later requirement edit re-flags this
    // slice stale. Best-effort — never fail the (already-gated) move on a
    // hashing error.
    if (specBody) {
      try {
        fm.verified_req_hash = requirementHash(specBody);
        baselineStamped = true;
      } catch (err) {
        process.stderr.write(
          `[thinkube-mcp] move_slice: baseline stamp for ${handle} failed: ${(err as Error).message}\n`,
        );
      }
    }
    // Record delivery provenance (branch HEAD commit + open PR) at Done time.
    // Best-effort and isolated from the baseline stamp above — a git/gh failure
    // here must never block the move.
    try {
      await stampOnEnteringDone(fm, store.workspaceRoot);
    } catch (err) {
      process.stderr.write(
        `[thinkube-mcp] move_slice: provenance stamp for ${handle} failed: ${(err as Error).message}\n`,
      );
    }
  }

  await store.writeFile(rel, fm, parsed.body);
  return {
    ok: true,
    slice: store.sliceHandle(specNumber, sliceNumber),
    status: target,
    baselineStamped,
    ...(gateSkipped ? { gateSkipped } : {}),
  };
}

/** Card-title character limit for `create_slice` (detail belongs in the body). */
const TITLE_MAX = 70;

/**
 * Create a slice in the canonical shape (SP-4): server-allocated per-Spec
 * number (archive-aware), slug uid, frontmatter + `# title` + detail body.
 * The → Ready gate is enforced at creation time: the parent Spec must exist
 * with a non-empty `## Acceptance Criteria`.
 */
async function createSlice(
  store: ThinkubeStore,
  args: {
    spec: number;
    title: string;
    body: string;
    depends_on?: string[];
    parallel?: boolean;
    satisfies?: number[];
    priority?: string;
  },
): Promise<unknown> {
  const title = args.title.trim();
  if (!title) throw new Error("title must not be empty.");
  if (title.length > TITLE_MAX) {
    throw new Error(
      `Title is ${title.length} chars — the limit is ${TITLE_MAX}. Title the concrete capability; detail belongs in the body.`,
    );
  }
  if (args.priority !== undefined && !/^P[0-3]$/.test(args.priority)) {
    throw new Error(`Invalid priority "${args.priority}" — expected P0…P3.`);
  }
  for (const dep of args.depends_on ?? []) {
    if (!SLICE_HANDLE_RE.test(dep.trim())) {
      throw new Error(
        `depends_on entry "${dep}" is not a full slice handle (SP-{n}_SL-{m}).`,
      );
    }
  }
  for (const n of args.satisfies ?? []) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `satisfies entry "${n}" is not a positive integer (a 1-based AC ordinal).`,
      );
    }
  }

  // Creation-time → Ready gate: parent Spec present with non-empty AC.
  const specDoc = await store.getFile(store.pathForSpecDoc(args.spec));
  if (!specDoc) {
    throw new Error(
      `No spec at .thinkube/specs/SP-${args.spec}/spec.md — run /spec-prepare ${args.spec} first.`,
    );
  }
  if (!hasNonEmptyAcceptanceCriteria(specDoc.body)) {
    throw new Error(
      `SP-${args.spec} has no acceptance criteria (its slices would fail the → Ready gate) — run /spec-prepare ${args.spec} first.`,
    );
  }

  const sliceNumber = await store.nextSliceNumber(args.spec);
  const uid = await uniqueSlug(store, args.spec, title);
  const fm: Frontmatter = {
    uid,
    parent: `SP-${args.spec}`,
    status: "ready",
  };
  if (args.depends_on?.length) fm.depends_on = args.depends_on;
  if (args.parallel) fm.parallel = true;
  if (args.satisfies?.length)
    fm.satisfies = [...new Set(args.satisfies)].sort((a, b) => a - b);
  if (args.priority) fm.priority = args.priority as Frontmatter["priority"];

  const rel = store.pathForSlice(args.spec, sliceNumber);
  await store.writeFile(rel, fm, `# ${title}\n\n${args.body.trim()}\n`);
  return {
    ok: true,
    slice: store.sliceHandle(args.spec, sliceNumber),
    relativePath: rel,
    uid,
  };
}

/** Non-empty = the section exists and contains at least one checklist line. */
function hasNonEmptyAcceptanceCriteria(body: string | undefined): boolean {
  if (!body) return false;
  const m = /##\s*Acceptance Criteria\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(body);
  if (!m) return false;
  return /[-*]\s*\[[ xX]\]/.test(m[1]);
}

/** Slug uid from the title, unique among the Spec's existing slice uids. */
async function uniqueSlug(
  store: ThinkubeStore,
  spec: number,
  title: string,
): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || `sp${spec}-slice`;
  const taken = new Set<string>();
  for (const rel of await store.listSlices(spec)) {
    const f = await store.getFile(rel);
    if (typeof f?.frontmatter?.uid === "string") taken.add(f.frontmatter.uid);
  }
  let slug = base;
  let i = 2;
  while (taken.has(slug)) slug = `${base}-${i++}`;
  return slug;
}

async function updateSlice(
  store: ThinkubeStore,
  handle: string,
  body: string,
): Promise<unknown> {
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at .thinkube/${rel}`);

  // Heading guard (SP-4): a body whose first non-empty line isn't a `#`
  // heading would regress the card to the merged-line shape — re-attach the
  // existing title and treat the input as detail instead.
  const firstLine = body.split(/\r?\n/).find((l) => l.trim());
  let nextBody = body;
  let titleReattached = false;
  if (!firstLine || !firstLine.trim().startsWith("#")) {
    const oldFirst = parsed.body.split(/\r?\n/).find((l) => l.trim());
    const oldTitle = (oldFirst ?? "").replace(/^#+\s*/, "").trim();
    if (oldTitle) {
      nextBody = `# ${oldTitle}\n\n${body.trim()}\n`;
      titleReattached = true;
    }
  }

  await store.writeFile(rel, parsed.frontmatter, nextBody);
  return {
    ok: true,
    slice: store.sliceHandle(specNumber, sliceNumber),
    relativePath: rel,
    titleReattached,
  };
}

async function writeDecision(
  store: ThinkubeStore,
  title: string,
  body: string,
): Promise<unknown> {
  // Find the next ADR number — list existing decisions, pick max + 1.
  const existing = await store.listKind("decision");
  const max = existing
    .map((p) => /ADR-(\d+)\.md$/.exec(p))
    .map((m) => (m ? Number(m[1]) : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const n = max + 1;
  const rel = store.pathFor("decision", n);
  const frontmatter = {
    kind: "decision" as const,
    status: "active" as const,
    created: new Date().toISOString().slice(0, 10),
  };
  const fileBody = `# ${title}\n\n${body}\n`;
  await store.writeFile(rel, frontmatter, fileBody);
  return { relativePath: rel, number: n };
}

async function writeRetroNote(
  store: ThinkubeStore,
  body: string,
): Promise<unknown> {
  const date = new Date().toISOString().slice(0, 10);
  const rel = store.pathFor("retro", date);
  const existing = await store.getFile(rel);
  const frontmatter = existing?.frontmatter ?? {
    kind: "retro" as const,
    status: "active" as const,
    created: date,
  };
  const previous = existing?.body ?? "";
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const appended = `${previous.trimEnd()}\n\n## ${stamp}\n\n${body}\n`;
  await store.writeFile(rel, frontmatter, appended);
  return { relativePath: rel };
}

// ─── Resource definitions + reader ──────────────────────────────────────────

const RESOURCE_DEFS = [
  {
    uri: "thinkube://board_state",
    name: "Board state",
    description:
      "Current Tandem board of this session's own repo: the Ready / Doing / Done columns projected from the committed slice files. (Resources are bound to the default board; use the tools' `board` parameter for other boards.)",
    mimeType: "application/json",
  },
  {
    uri: "thinkube://thinkube_file/{path}",
    name: "A .thinkube file",
    description:
      "Read a specific `.thinkube/*.md` file from this session's own repo. Substitute `{path}` with the relative path.",
    mimeType: "application/json",
  },
];

async function readResource(uri: string, ctx: HandlerContext): Promise<string> {
  // Resources can't take parameters — they are bound to the default board.
  const store = ctx.boards.resolve(undefined);
  if (uri === "thinkube://board_state") {
    return JSON.stringify(await listBoard(store), null, 2);
  }
  const fileMatch = /^thinkube:\/\/thinkube_file\/(.+)$/.exec(uri);
  if (fileMatch) {
    return JSON.stringify(
      await getThinkubeFile(store, decodeURIComponent(fileMatch[1])),
      null,
      2,
    );
  }
  throw new Error(`unknown resource: ${uri}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function asString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string")
    throw new Error(`argument ${key} must be a string`);
  return v;
}

function optString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string")
    throw new Error(`argument ${key} must be a string`);
  return v;
}

function asNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
    throw new Error(`argument ${key} must be a positive integer`);
  return v;
}

function optBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean")
    throw new Error(`argument ${key} must be a boolean`);
  return v;
}

function optStringArray(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw new Error(`argument ${key} must be an array of strings`);
  return v as string[];
}

function optNumberArray(
  args: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "number"))
    throw new Error(`argument ${key} must be an array of numbers`);
  return v as number[];
}

// Kick off LAST: `main()` references classes (BoardRegistry) that — unlike
// function declarations — are not hoisted, so launching at the top of the
// module dies in the temporal dead zone.
main().catch((err) => {
  process.stderr.write(
    `[thinkube-mcp] startup failed: ${(err as Error).stack ?? err}\n`,
  );
  process.exit(1);
});
