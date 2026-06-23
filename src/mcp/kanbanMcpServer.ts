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
 * Source of truth: the committed `specs/SP-{n}/SL-{m}.md` slice files in the
 * board's sidecar namespace (`<board-root>/<container>/<rel>`, ADR-0008), plus
 * the parent `SP-{n}/spec.md` documents. There is NO GitHub here —
 * this server reads and writes only through `ThinkubeStore` and projects the
 * board with the same pure `sliceBoard.ts` logic the panel uses, so the MCP
 * surface and the kanban panel always agree.
 *
 * State plumbing: this is a separate Node process, so settings come in via
 * environment variables (baked into `.mcp.json` by the bundle installer, or
 * injected by the VS Code provider):
 *
 *   THINKUBE_ROOTS            path-delimiter-separated directories scanned for
 *                             boards (repos whose sidecar board dir exists).
 *                             Optional — defaults to the session's own repo.
 *   THINKUBE_ALLOW_AI_WRITES  "true" | "false" — gates every mutating tool.
 *                             One global flag: solo platform, git is the undo
 *                             (ADR-0007 Phase-6 decision).
 *   THINKUBE_WORKSPACE        legacy single-board binding; honoured as a
 *                             fallback root / default board so `.mcp.json`
 *                             files from older bundle installs keep working.
 *   THINKUBE_BOARD_ROOT       central board root (SP-8): boards live at
 *                             <root>/<container>/<rel>, not co-located.
 *   THINKUBE_FOLDERS          JSON [{name,path}] of workspace folders; the
 *                             folder name supplies the namespace container.
 *
 * Logging: stderr only. VS Code captures it under the MCP server's output
 * channel; never print to stdout — that channel is the protocol stream.
 */
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { requirementHash } from "../methodology/specChange";
import { sectionPatch } from "../methodology/sectionPatch";
import { sliceFilesResolveInRepo } from "../methodology/sliceRepoGuard";
import {
  validateParallelGroup,
  type ParallelSliceInput,
} from "../methodology/parallelSlices";
import {
  CONTROL_DIR_ENV,
  serializeControlRequest,
  startWorktreeRequestFile,
} from "./controlRequests";
import {
  gateSliceSatisfiesToDone,
  gateSpecAcceptance,
  gateSliceDocsToDone,
  resolveDocsObligation,
  type DocsGateMode,
} from "../methodology/qualityGates";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { isBoardDir } from "./boardDetection";
import { resolveServerConfig, type ServerConfigFile } from "./serverConfig";
import type { Frontmatter } from "../store/frontmatter";
import { effectiveTags } from "../store/frontmatter";
import { groupByTag, type TaggedItem } from "../store/tags";
import { discoverProducts } from "../store/products";
import { discoverProjects, projectTeps } from "../store/projects";
import {
  parseImplements,
  normalizeTepId,
  rewriteImplementsForPromote,
} from "../store/implementsRef";
import { stampOnEnteringDone } from "../github/sliceProvenance";
import { linkedWorktreeInfo } from "../services/WorktreeService";
import {
  boardDirForNamespace,
  namespaceForRepo,
  type WorkspaceFolderRef,
} from "../store/boardNamespace";
import {
  buildSliceBoard,
  deriveSpecMeta,
  SliceInput,
  sliceHandle,
  SpecMeta,
} from "../views/kanban/host/storage/sliceBoard";

interface ServerEnv {
  roots: string[];
  /** Workspace folders with names — supply the namespace container (SP-8). */
  folders: WorkspaceFolderRef[];
  /** Central board root; when set, boards live at <root>/<container>/<rel>. */
  boardRoot?: string;
  allowAIWrites: boolean;
  /** → Done docs gate mode (TEP-tgh6iy): advisory warns, blocking refuses. */
  docsGateMode: DocsGateMode;
  legacyWorkspace?: string;
}

/** The machine-level config file the extension writes (TEP-tgvwct Phase 3) so
 *  the plugin-shipped server self-configures without per-repo `.mcp.json` env
 *  injection. Missing / unparseable → null (env + cwd discovery still apply). */
function readConfigFile(): ServerConfigFile | null {
  const dir =
    process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  try {
    return JSON.parse(
      fsSync.readFileSync(path.join(dir, "thinkube-mcp.json"), "utf8"),
    ) as ServerConfigFile;
  } catch {
    return null;
  }
}

/** Effective config: `THINKUBE_*` env (back-compat) → machine-level file → cwd
 *  discovery (in BoardRegistry). See `serverConfig.resolveServerConfig`. */
function readEnv(): ServerEnv {
  return resolveServerConfig(process.env, readConfigFile(), path.delimiter);
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
  /** The board dir (the `.thinkube`-equivalent) — central or co-located (SP-8). */
  boardDir: string;
  /**
   * True when this entry is a linked git worktree (SP-5/SP-9), not a standalone
   * board: it shares its canonical repo's namespace. Listed separately so the
   * board vocabulary stays a list of logical Thinking Spaces, not checkouts.
   */
  worktree?: boolean;
}

const DISCOVERY_TTL_MS = 10_000;
const MAX_WALK_DEPTH = 3;

/**
 * Discovers boards under the configured roots and resolves `board` arguments to
 * `ThinkubeStore`s. Discovery mirrors the navigator's `discoverRepos`: a
 * directory containing `.git` is a repo and a leaf; it is a board iff its board
 * dir exists — the central sidecar namespace (ADR-0008) or a co-located
 * `.thinkube/`. Linked worktrees map to their canonical repo's namespace.
 */
export class BoardRegistry {
  /** The session's own board: the enabled repo containing process.cwd(). */
  readonly defaultBoardPath: string | undefined;

  private readonly env: ServerEnv;
  private readonly roots: string[];
  private readonly stores = new Map<string, ThinkubeStore>();
  private discovered: BoardInfo[] | undefined;
  private discoveredAt = 0;

  constructor(env: ServerEnv) {
    this.env = env;
    this.defaultBoardPath =
      findEnclosingBoard(process.cwd(), env) ??
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
        walkForBoards(root, 0, found, this.env);
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
    if (this.env.boardRoot && !fsSync.existsSync(this.env.boardRoot)) {
      throw new Error(
        `Board repo not available: thinkube.boards.root (${this.env.boardRoot}) does not exist — clone or mount the board repo.`,
      );
    }
    if (boardArg === undefined || boardArg.trim() === "") {
      if (!this.defaultBoardPath) {
        throw new Error(
          "No default board: this session's cwd is not inside a repo with a board-shaped board dir (a `specs/` directory). Pass `board` explicitly — call list_boards for the available ids." +
            this.missingBoardRootHint(),
        );
      }
      return this.storeFor(
        this.defaultBoardPath,
        boardDirOf(this.defaultBoardPath, this.env),
      );
    }

    const arg = boardArg.trim();
    if (path.isAbsolute(arg)) {
      const boardDir = boardDirOf(arg, this.env);
      if (!isBoardDir(boardDir)) {
        throw new Error(
          `"${arg}" is not a board — no board-shaped board directory at ${boardDir}.` +
            this.missingBoardRootHint(),
        );
      }
      return this.storeFor(arg, boardDir);
    }

    const boards = this.list();
    const exact = boards.find((b) => b.id === normalizeId(arg));
    if (exact) return this.storeFor(exact.path, exact.boardDir);

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

  /**
   * Hint appended to "not a board" errors when no board root is configured —
   * the common cause is a missing `thinkube.boards.root` / `THINKUBE_BOARD_ROOT`
   * for a board that lives in a central sidecar. Without it we'd resolve to a
   * fabricated co-located `.thinkube/` (TEP-tghb9t). Empty when one IS set.
   */
  private missingBoardRootHint(): string {
    return this.env.boardRoot
      ? ""
      : " (No thinkube.boards.root / THINKUBE_BOARD_ROOT is configured — if this repo's board lives in a central sidecar, that setting is required.)";
  }

  private storeFor(repoPath: string, boardDir: string): ThinkubeStore {
    let store = this.stores.get(repoPath);
    if (!store) {
      store = new ThinkubeStore(repoPath, boardDir);
      this.stores.set(repoPath, store);
    }
    return store;
  }
}

function isBoard(dir: string): boolean {
  // Legacy co-located board: a `<dir>/.thinkube/` that is board-shaped (has
  // `specs/`). A bare `.thinkube/` holding something else (e.g. an api-token
  // store) is NOT a board — see boardDetection.ts (TEP-tghb9t).
  return isBoardDir(path.join(dir, ".thinkube"));
}

/**
 * The board dir for a repo: central `<board-root>/<namespace>` when a board
 * root is configured and the repo maps to a namespace, else the co-located
 * `<repo>/.thinkube` (legacy default + fallback for unmapped paths). Mirrors
 * the navigator's resolver (SP-8).
 */
function boardDirOf(repoPath: string, env: ServerEnv): string {
  if (env.boardRoot) {
    // A linked worktree shares its canonical Spec's board (SP-9): map it to the
    // canonical repo's namespace, not the worktree's own out-of-folder path. So
    // a worktree session's default board + addressing both resolve to the same
    // central board as the canonical repo.
    const wt = linkedWorktreeInfo(repoPath);
    const ns = namespaceForRepo(wt ? wt.canonicalRepo : repoPath, env.folders);
    if (ns) return boardDirForNamespace(env.boardRoot, ns);
  }
  return path.join(repoPath, ".thinkube");
}

/**
 * Walk up from `start` to the enclosing board: a repo (`.git`) whose board dir
 * exists, or a legacy dir with a co-located `.thinkube/` even without `.git`.
 */
function findEnclosingBoard(start: string, env: ServerEnv): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    const isRepo = fsSync.existsSync(path.join(dir, ".git"));
    if ((isRepo && isBoardDir(boardDirOf(dir, env))) || isBoard(dir)) {
      return dir;
    }
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
  env: ServerEnv,
): void {
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const gitEntry = entries.find((e) => e.name === ".git");
  if (gitEntry) {
    // A repo (`.git` dir) or a linked worktree (`.git` file) — a leaf. It is a
    // board iff its board dir exists. A worktree (SP-5/SP-9) carries NO board of
    // its own: its board is the CANONICAL Spec's central namespace, and it
    // displays as a worktree of its canonical repo.
    const abs = path.resolve(dir);
    const wt = gitEntry.isFile() ? linkedWorktreeInfo(abs) : undefined;
    const boardDir = boardDirOf(abs, env); // boardDirOf maps a worktree → canonical
    if (isBoardDir(boardDir)) {
      const name = wt
        ? `${path.basename(wt.canonicalRepo)} · ${wt.name} worktree`
        : path.basename(abs);
      out.set(abs, {
        id: boardId(abs),
        name,
        path: abs,
        boardDir,
        worktree: !!wt,
      });
    }
    return; // a repo is a leaf — no nested boards
  }
  // Legacy: a co-located `.thinkube/` without a `.git` (e.g. a bare workspace).
  if (isBoard(dir)) {
    const abs = path.resolve(dir);
    out.set(abs, {
      id: boardId(abs),
      name: path.basename(abs),
      path: abs,
      boardDir: path.join(abs, ".thinkube"),
    });
    return;
  }
  if (depth >= MAX_WALK_DEPTH) return;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    walkForBoards(path.join(dir, e.name), depth + 1, out, env);
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
      "Discover every Tandem board across the configured roots: repos whose board dir exists in the central sidecar namespace `<board-root>/<container>/<rel>` (ADR-0008). Returns each board's canonical id (home-relative path — the value to pass as `board` to the other tools), name, and absolute path, plus which board is this session's default. Linked git worktrees are omitted (they share their canonical repo's board — address them by that repo's id). The semantic location is part of the id (`apps/…` = deployed app, `user-templates/…` = template, `thinkube-platform/…` = platform code).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_tags",
    description:
      "Aggregate the #hashtag mesh (SP-tgvil2) across every board in the workspace. Returns each tag with its `count` and the `items` carrying it ({ board: the board id, handle: SP-{n} | SP-{n}_SL-{m} | TEP-{id}, kind }), sorted by tag. An item with N tags appears under all N; a tag clusters items from multiple boards (the cross-board clustering layer — a project is a promoted tag). Folds a legacy `theme:` in as a tag.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_products",
    description:
      "List Products — the code-less top nodes of the hierarchy (SP-tgvjug / TEP-tgvh8p). A Product is a top-level directory in the sidecar board root whose member Thinking Spaces are the board namespaces nested under it. Returns each Product `{ id, name (from <product>/product.yaml, else the id), members: namespaces }`, sorted by id. Empty when no board root is configured. Products generalize the old fixed Platform/Apps/Templates containers into arbitrary user-defined groupings; a Project (later) is a tag promoted under a Product.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_projects",
    description:
      "List Projects across all Products (SP-tgvkmt / TEP-tgvh8p). A Project is a bounded multi-repo effort = a promoted tag with a version-controlled home (`<product>/projects/<name>/project.yaml`). Returns each Project `{ product, id, name, state (open|done), tag, tep? }`, sorted. Empty when no board root is configured. Use `get_project` to resolve a project's members (the items carrying its tag).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_project",
    description:
      "Get one Project's umbrella TEPs + its members (SP-tgvpbm). A Project is a code-less umbrella owning TEPs; its members are the specs (across boards) whose `implements:` resolves to one of those TEPs, plus their slices (inherited) — structural, not tags. Returns `{ project, teps: [TEP-id], members: [{ board, handle, kind }] }`.",
    inputSchema: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description:
            "The Product (top sidecar dir) the project lives under, e.g. `Platform`.",
        },
        id: {
          type: "string",
          description:
            "The project id (its directory name under `<product>/projects/`).",
        },
      },
      required: ["product", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "promote_tep",
    description:
      "Promote a repo TEP into an existing Project's umbrella (SP-tgvpbm). Moves `TEP-<tep>` out of its repo's `teps/` into `<product>/projects/<id>/teps/`, then rewrites EVERY spec that implemented it (across boards) to the qualified umbrella ref — so all former implementers stay members and no dangling/bare ref remains. Returns `{ tep, movedTo, rewritten: [SP-handles] }`. The Project must already exist (create it with New Project first).",
    inputSchema: {
      type: "object",
      properties: {
        tep: {
          type: "string",
          description:
            "The TEP id to promote (with or without the `TEP-` prefix).",
        },
        product: {
          type: "string",
          description:
            "The Product the target project lives under, e.g. `Platform`.",
        },
        id: {
          type: "string",
          description: "The target project's id (under `<product>/projects/`).",
        },
      },
      required: ["tep", "product", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_board",
    description:
      "Current Tandem board, projected from the committed `specs/SP-{n}/SL-{m}.md` slice files (in the board's sidecar namespace). Returns the Ready / Doing / Done columns; each card carries its slice handle (`id`, e.g. `SP-3_SL-42`), title (`description`), and `specStale` / `specChange` (whether the parent Spec's requirements changed since the slice was last verified).",
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
      "Read a specific markdown file from the board (frontmatter + body). Path is relative to the board directory (the sidecar namespace).",
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
      "Move a slice to a different column by setting its `status:` frontmatter. Status must be one of: Ready, Doing, Done, Requires-attention (a needs-human state the orchestrator sets when a worker can't resolve a problem — SP-tgs8nz; /attend returns it to the loop). Moving to Done is REFUSED unless every acceptance criterion the slice lists in `satisfies` is checked on the parent Spec (the error names the offending criterion); slices with no `satisfies` are not gated. The → Done **docs gate** (TEP-tgh6iy) also applies: a `docs: required` slice must have its documentation done — pass `docs_done: true` once you've updated the doc module. In blocking mode an unsatisfied obligation is refused; in advisory mode (default) the move returns a `docsWarning`. On a successful Done it stamps the slice's `verified_req_hash` from the parent Spec so a later requirement edit re-flags it stale.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description: "Slice handle, e.g. `SP-3_SL-42`.",
        },
        status: {
          type: "string",
          enum: ["Ready", "Doing", "Done", "Requires-attention"],
        },
        docs_done: {
          type: "boolean",
          description:
            "Attest that a `docs: required` slice's documentation was updated in this slice (TEP-tgh6iy). Satisfies the → Done docs gate; persisted as `docs_done` on the slice. Only meaningful when moving to Done.",
        },
        ...BOARD_PARAM,
      },
      required: ["slice", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "accept_spec",
    description:
      "Record the human acceptance of a Spec — the single end-of-Spec gate (TEP-0010). REFUSED unless every slice under the Spec is Done and every acceptance criterion is checked on the Spec (the error names the blocker). On success it stamps `accepted:` on the Spec, so the acceptance card may enter Done and the Spec's PR merge.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description: "The Spec id (SP-{id}) to accept.",
        },
        ...BOARD_PARAM,
      },
      required: ["spec"],
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
          type: "string",
          description:
            "Parent Spec id (the SP-{id} this slice belongs to) — an opaque string (base36-epoch for new Specs, a legacy integer for old ones).",
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
        parallel_group: {
          type: "string",
          description:
            "Named concurrency group (SP-tgpwbm). Slices sharing a parallel_group may run in parallel worktrees, so their `files` sets must be disjoint — the server refuses a group whose members overlap, naming the conflicting files.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            'Repo-relative paths this slice will edit (its machine-readable file set), e.g. ["src/a.ts"]. The unit of disjointness for a parallel_group and, later, the ownership arbiter.',
        },
        satisfies: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          description:
            "1-based AC ordinals this slice delivers (positions in the parent Spec's `## Acceptance Criteria`). Arms the → Done gate: the slice can't reach Done until each listed criterion is checked on the Spec.",
        },
        work_units: {
          type: "array",
          items: {
            type: "object",
            properties: {
              footprint: { type: "array", items: { type: "string" } },
              depends_on: { type: "array", items: { type: "string" } },
              execution: {
                type: "string",
                enum: ["serial", "mechanize", "fan-out"],
              },
              note: { type: "string" },
            },
            required: ["footprint", "execution"],
            additionalProperties: false,
          },
          description:
            "Execution-aware work units (SP-tgs8gb): each { footprint (files/objects it touches), depends_on?, execution: serial|mechanize|fan-out, note? (the unit's task text — self-describing, required in practice for fan-out) }. Uniform data-parallel work collapses to one `mechanize` unit; heterogeneous → `fan-out` (one per object, each with its `note`); coupled → `serial`. The slice stays the validation envelope; work units are never independently gated.",
        },
        docs: {
          type: "string",
          enum: ["required", "n/a"],
          description:
            "Documentation obligation (TEP-tgh6iy). `required` (default) arms the → Done docs gate for user-facing work; `n/a` skips it but requires `docs_reason`. Internal refactors / test-only / infra are `n/a`.",
        },
        docs_reason: {
          type: "string",
          description:
            "One-line justification, required when `docs: n/a` — why this slice needs no documentation.",
        },
        priority: {
          type: "string",
          enum: ["P0", "P1", "P2", "P3"],
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Free-form clustering tags — the #hashtag mesh (SP-tgvil2): component (`keycloak`), concern (`security`), project (`rebrand`). Many-to-many, cross-board (surfaced by `list_tags`).",
        },
        ...BOARD_PARAM,
      },
      required: ["spec", "title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "write_spec",
    description:
      "Write a Spec's document at `specs/SP-{id}/spec.md` in the board (the sidecar namespace), creating it if absent. Replaces the markdown body; existing frontmatter (e.g. `accepted:`) is preserved, and `implements:` can be set via its parameter. This is the board-aware write path for `/spec-prepare` — use it instead of a raw file write, which would land outside the board.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "Spec id (the SP-{id}) — an opaque string (base36-epoch for new Specs, a legacy integer for old ones).",
        },
        body: {
          type: "string",
          description:
            "The full Spec markdown body (the `# title` heading + the four canonical sections).",
        },
        implements: {
          type: "string",
          description:
            "The TEP this Spec implements — a bare `TEP-<id>` (repo-local) or a qualified `<namespace>:TEP-<id>` (cross-board / umbrella project). Sets the `implements:` frontmatter (the TEP↔spec link + umbrella membership, which `promote_tep` rewrites). Omit to leave it unchanged; empty string clears it.",
        },
        ac_verifications: {
          type: "object",
          description:
            "The closing AI-verification gate's per-AC declaration (SP-tgzyfy / TEP-tgzx3p): a map keyed by 1-based AC ordinal → `{ run, env? }`, where `run` is the shell/playbook command that verifies that AC (exit 0 = pass) and `env` is `cluster` (an infra lifecycle) or `local`. The orchestrator runs the union as a full plan at Spec quiescence and gates Done/commit on all-green (no skip; red or un-runnable → requires-attention). Sets the `ac_verifications:` frontmatter; omit to leave unchanged, pass `{}` to clear.",
          additionalProperties: {
            type: "object",
            properties: {
              run: { type: "string" },
              env: { type: "string", enum: ["cluster", "local"] },
            },
            required: ["run"],
            additionalProperties: false,
          },
        },
        ...BOARD_PARAM,
      },
      required: ["spec", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "patch_spec_section",
    description:
      "Replace exactly ONE named section of an existing Spec's body, leaving every other section byte-identical, and write the whole body back through the secret-scanning safe-write path. Use this for a single-section edit (e.g. updating `## Acceptance Criteria`) instead of the read-modify-write-whole-body dance — `write_spec` replaces the entire body, this surgically patches one section. The `section` is the heading text (without leading `#`s); the Spec must already exist. Frontmatter is preserved.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "Spec id (the SP-{id}) whose section to patch — an opaque string (base36-epoch for new Specs, a legacy integer for old ones).",
        },
        section: {
          type: "string",
          description:
            "The heading of the section to replace — the heading text without the leading `#`s (e.g. `Acceptance Criteria`).",
        },
        content: {
          type: "string",
          description:
            "The replacement content for that named section. Every other section of the Spec is left byte-identical.",
        },
        ...BOARD_PARAM,
      },
      required: ["spec", "section", "content"],
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
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Replace the slice's clustering tags (SP-tgvil2). Omit to leave tags unchanged; pass `[]` to clear.",
        },
        ...BOARD_PARAM,
      },
      required: ["slice", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "write_tep",
    description:
      "Write a Tandem Enhancement Proposal at `teps/TEP-<id>.md` in the board (the sidecar namespace), creating it if absent (TEP-0009). The board-aware write path for `/tep` — use it instead of a raw file write. Omit `tep` to mint a conflict-free base36-epoch id; pass it to update an existing TEP. On create, the body defaults to the `TEP-TEMPLATE.md` scaffold and canonical frontmatter (kind/id/status/created/implemented_by) is filled; on update, existing frontmatter is preserved. `title`/`status` set those fields.",
    inputSchema: {
      type: "object",
      properties: {
        tep: {
          type: "string",
          description:
            "TEP id (with or without the `TEP-` prefix). Omit to mint a new base36-epoch id.",
        },
        title: { type: "string", description: "TEP title (frontmatter)." },
        status: {
          type: "string",
          description: "Lifecycle status: proposed | accepted | superseded.",
        },
        body: {
          type: "string",
          description:
            "The TEP markdown body. Omit on create to scaffold from TEP-TEMPLATE.md.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Clustering tags for the TEP — the #hashtag mesh (SP-tgvil2), surfaced cross-board by `list_tags`.",
        },
        ...BOARD_PARAM,
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "write_retro_note",
    description:
      "Append a retro note to today's `retros/{YYYY-MM-DD}.md` in the board.",
    inputSchema: {
      type: "object",
      properties: { body: { type: "string" }, ...BOARD_PARAM },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "start_spec_worktree",
    description:
      "Open the Spec's git worktree session (the 'Start Spec in Worktree' action) without a manual button — so a session that just sliced a Spec can hand off directly into a board-connected worktree pair session. Writes a one-shot control request the Extension Host picks up via a file watcher (the same MCP→host filesystem channel the board uses), which runs `thinkube.specs.startWorktree` (create-or-reuse + board-root inject + open session). Requires the host to be running.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "The Spec id (the SP-{id}) whose worktree session to open — an opaque string (base36-epoch or a legacy integer).",
        },
        ...BOARD_PARAM,
      },
      required: ["spec"],
      additionalProperties: false,
    },
  },
];

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
  writeGate: (n: string) => void,
): Promise<unknown> {
  if (name === "list_boards") return listBoards(ctx);
  if (name === "list_tags") return listTags(ctx);
  if (name === "list_products") return listProducts(ctx);
  if (name === "list_projects") return listProjects(ctx);
  if (name === "get_project")
    return getProject(ctx, asString(args, "product"), asString(args, "id"));
  if (name === "promote_tep") {
    writeGate(name);
    return promoteTep(
      ctx,
      asString(args, "tep"),
      asString(args, "product"),
      asString(args, "id"),
    );
  }

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
        {
          docsGateMode: ctx.env.docsGateMode,
          docsDone: optBoolean(args, "docs_done"),
        },
      );
    case "accept_spec":
      writeGate(name);
      return acceptSpec(
        store,
        typeof args.spec === "number"
          ? String(args.spec)
          : asString(args, "spec"),
      );
    case "create_slice":
      writeGate(name);
      return createSlice(store, {
        // Spec id is a string (base36-epoch); tolerate a numeric integer id
        // from callers that still pass a number (legacy specs).
        spec:
          typeof args.spec === "number"
            ? String(args.spec)
            : asString(args, "spec"),
        title: asString(args, "title"),
        body: asString(args, "body"),
        depends_on: optStringArray(args, "depends_on"),
        parallel: optBoolean(args, "parallel"),
        parallel_group: optString(args, "parallel_group"),
        files: optStringArray(args, "files"),
        satisfies: optNumberArray(args, "satisfies"),
        // The execution-aware work units (SP-tgs8gb). Forwarded verbatim — createSlice
        // validates each unit's footprint and serializes the array to frontmatter. Without
        // this line the schema accepts work_units but the handler silently drops it (the
        // bug that left every created slice with no work_units).
        work_units: Array.isArray(args.work_units)
          ? (args.work_units as {
              footprint: string[];
              depends_on?: string[];
              execution: string;
              note?: string;
            }[])
          : undefined,
        docs: optString(args, "docs"),
        docs_reason: optString(args, "docs_reason"),
        priority: optString(args, "priority"),
        tags: optStringArray(args, "tags"),
      });
    case "write_spec":
      writeGate(name);
      return writeSpec(
        store,
        typeof args.spec === "number"
          ? String(args.spec)
          : asString(args, "spec"),
        asString(args, "body"),
        optString(args, "implements"),
        // The closing gate's per-AC declaration (SP-tgzyfy). Forwarded verbatim — writeSpec
        // normalizes + serializes it to the `ac_verifications:` frontmatter; undefined leaves
        // any existing map intact, `{}` clears it.
        args.ac_verifications !== undefined &&
          typeof args.ac_verifications === "object" &&
          !Array.isArray(args.ac_verifications)
          ? (args.ac_verifications as Record<string, unknown>)
          : undefined,
      );
    case "patch_spec_section":
      writeGate(name);
      return patchSpecSection(
        store,
        typeof args.spec === "number"
          ? String(args.spec)
          : asString(args, "spec"),
        asString(args, "section"),
        asString(args, "content"),
      );
    case "update_slice":
      writeGate(name);
      return updateSlice(
        store,
        asString(args, "slice"),
        asString(args, "body"),
        optStringArray(args, "tags"),
      );
    case "write_tep":
      writeGate(name);
      return writeTep(store, {
        tep: optString(args, "tep"),
        title: optString(args, "title"),
        status: optString(args, "status"),
        body: optString(args, "body"),
        tags: optStringArray(args, "tags"),
      });
    case "write_retro_note":
      writeGate(name);
      return writeRetroNote(store, asString(args, "body"));
    case "start_spec_worktree":
      writeGate(name);
      return startSpecWorktree(
        typeof args.spec === "number"
          ? String(args.spec)
          : asString(args, "spec"),
        store.workspaceRoot,
      );
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ─── Tool implementations ───────────────────────────────────────────────────

/**
 * Hand off "open this Spec's worktree session" to the Extension Host (AC8). The
 * MCP process can't open a VS Code session itself, so it writes a one-shot
 * control request into the host-published `THINKUBE_CONTROL_DIR`; the host's
 * file watcher consumes it and runs `thinkube.specs.startWorktree` (the same
 * create-or-reuse + board-root inject + open-session machinery as the button,
 * SL-7). Reuses the board's filesystem MCP→host channel — not the tmux bridge.
 */
async function startSpecWorktree(spec: string, repo: string): Promise<unknown> {
  const dir = process.env[CONTROL_DIR_ENV];
  if (!dir) {
    throw new Error(
      `${CONTROL_DIR_ENV} is not set, so the worktree hand-off can't reach the extension. Open the worktree from the Specs view button, or re-install the methodology bundle so the MCP env carries it.`,
    );
  }
  await fsSync.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, startWorktreeRequestFile(spec));
  await fsSync.promises.writeFile(
    file,
    serializeControlRequest({ kind: "start-worktree", spec, repo }),
    "utf8",
  );
  return { ok: true, spec, request: file };
}

const SLICE_PATH_RE = /specs\/SP-([A-Za-z0-9]+)\/SL-(\d+)\.md$/;
const SLICE_HANDLE_RE = /^SP-([A-Za-z0-9]+)_SL-(\d+)$/;
const VALID_STATUSES = [
  "ready",
  "doing",
  "done",
  "requires-attention",
] as const;

function listBoards(ctx: HandlerContext): unknown {
  // A linked worktree shares its canonical repo's board (it is addressable via
  // that repo's id), so it is not its own Thinking Space — omit worktree
  // checkouts so the vocabulary lists logical boards, not checkouts.
  return {
    defaultBoard: ctx.boards.defaultBoardId() ?? null,
    boards: ctx.boards
      .list(true)
      .filter((b) => !b.worktree)
      .map((b) => ({
        id: b.id,
        name: b.name,
        path: b.path,
      })),
  };
}

/** Collect every tagged item (spec / TEP / slice) in one board's store. */
async function collectTaggedItems(
  store: ThinkubeStore,
  boardId: string,
  out: TaggedItem[],
): Promise<void> {
  for (const t of await store.listTeps()) {
    const tags = effectiveTags(
      (await store.getFile(t.relativePath))?.frontmatter,
    );
    if (tags.length)
      out.push({ boardId, handle: `TEP-${t.id}`, kind: "tep", tags });
  }
  for (const spec of await store.listSpecDirs()) {
    const tags = effectiveTags(
      (await store.getFile(store.pathForSpecDoc(spec)))?.frontmatter,
    );
    if (tags.length)
      out.push({ boardId, handle: `SP-${spec}`, kind: "spec", tags });
  }
  for (const rel of await store.listSlices()) {
    const m = SLICE_PATH_RE.exec(rel);
    if (!m) continue;
    const tags = effectiveTags((await store.getFile(rel))?.frontmatter);
    if (tags.length)
      out.push({
        boardId,
        handle: sliceHandle(m[1], Number(m[2])),
        kind: "slice",
        tags,
      });
  }
}

export interface TagAggregate {
  tag: string;
  count: number;
  items: { board: string; handle: string; kind: string }[];
}

/**
 * Walk a set of boards, collect their tagged items, and group by tag — the pure
 * core of `list_tags` (exported for testing against tmp stores; the registry
 * walk in `listTags` is the thin glue over it).
 */
export async function aggregateTagsAcrossBoards(
  boards: { boardId: string; store: ThinkubeStore }[],
): Promise<TagAggregate[]> {
  const items: TaggedItem[] = [];
  for (const b of boards) await collectTaggedItems(b.store, b.boardId, items);
  return [...groupByTag(items).entries()]
    .map(([tag, its]) => ({
      tag,
      count: its.length,
      items: its.map((i) => ({
        board: i.boardId,
        handle: i.handle,
        kind: i.kind,
      })),
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/** `list_tags` — aggregate tags across every (non-worktree) board in the workspace. */
async function listTags(ctx: HandlerContext): Promise<unknown> {
  const boards = ctx.boards
    .list(true)
    .filter((b) => !b.worktree)
    .map((b) => ({ boardId: b.id, store: ctx.boards.resolve(b.id) }));
  return { tags: await aggregateTagsAcrossBoards(boards) };
}

/** `list_products` — Products (code-less top nodes) discovered from the sidecar
 * board root, each with its member namespaces. Empty when no board root is set. */
export function listProducts(ctx: HandlerContext): unknown {
  return {
    products: ctx.env.boardRoot ? discoverProducts(ctx.env.boardRoot) : [],
  };
}

/** `list_projects` — every product's Projects (manifests) discovered from the
 * sidecar board root. Empty when no board root is set. */
export function listProjects(ctx: HandlerContext): unknown {
  return {
    projects: ctx.env.boardRoot ? discoverProjects(ctx.env.boardRoot) : [],
  };
}

/**
 * `get_project` — a Project's manifest + its members (SP-tgvpbm). A Project is a
 * code-less umbrella owning TEPs; its members are the specs (across boards) whose
 * `implements:` resolves to one of the project's umbrella TEPs, PLUS each such
 * spec's slices (inherited). Membership is structural (`implements:`), not tags.
 * Throws if the project is unknown.
 */
export async function getProject(
  ctx: HandlerContext,
  product: string,
  id: string,
): Promise<unknown> {
  const boardRoot = ctx.env.boardRoot;
  const project = (boardRoot ? discoverProjects(boardRoot) : []).find(
    (p) => p.product === product && p.id === id,
  );
  if (!project) {
    throw new Error(`No project "${product}/${id}" under the board root.`);
  }
  const projectNamespace = `${product}/projects/${id}`;
  const tepIds = projectTeps(boardRoot!, product, id).map(normalizeTepId);

  const members: { board: string; handle: string; kind: string }[] = [];
  for (const b of ctx.boards.list(true).filter((bb) => !bb.worktree)) {
    const store = ctx.boards.resolve(b.id);
    for (const spec of await store.listSpecDirs()) {
      const fm = (await store.getFile(store.pathForSpecDoc(spec)))?.frontmatter;
      const ref = parseImplements(
        typeof fm?.implements === "string" ? fm.implements : undefined,
      );
      // A member's `implements:` is qualified to this project's namespace and an
      // umbrella TEP it owns. (A bare ref is repo-local → never a project member.)
      if (
        !ref ||
        ref.namespace !== projectNamespace ||
        !tepIds.includes(ref.id)
      ) {
        continue;
      }
      members.push({ board: b.id, handle: `SP-${spec}`, kind: "spec" });
      // Slices inherit membership from their spec.
      for (const rel of await store.listSlices(spec)) {
        const m = SLICE_PATH_RE.exec(rel);
        if (m)
          members.push({
            board: b.id,
            handle: sliceHandle(m[1], Number(m[2])),
            kind: "slice",
          });
      }
    }
  }
  return {
    project,
    teps: tepIds.map((t) => `TEP-${t}`),
    members,
  };
}

/** A board's sidecar namespace = its board dir relative to the board root. */
function namespaceOfBoardDir(boardRoot: string, boardDir: string): string {
  return path.relative(boardRoot, boardDir).split(path.sep).join("/");
}

/**
 * `promote_tep` (SP-tgvpbm) — move a repo TEP into an existing project's `teps/`
 * (making it an umbrella TEP) and rewrite **every** dependent spec's
 * `implements:` to the qualified umbrella ref, so all former implementers stay
 * members and no bare/dangling ref to the moved TEP remains. Targets an existing
 * project; refuses otherwise. Returns the moved path + the rewritten spec handles.
 */
export async function promoteTep(
  ctx: HandlerContext,
  tepArg: string,
  product: string,
  projectId: string,
): Promise<unknown> {
  const boardRoot = ctx.env.boardRoot;
  if (!boardRoot) throw new Error("No board root configured.");
  const tepId = normalizeTepId(tepArg);
  const project = discoverProjects(boardRoot).find(
    (p) => p.product === product && p.id === projectId,
  );
  if (!project) {
    throw new Error(
      `No project "${product}/${projectId}" — create it first (New Project).`,
    );
  }
  const projectNamespace = `${product}/projects/${projectId}`;
  const boards = ctx.boards.list(true).filter((b) => !b.worktree);

  // Locate the TEP's origin board (the repo whose teps/ holds TEP-{id}).
  let origin: { boardDir: string; namespace: string } | undefined;
  for (const b of boards) {
    const store = ctx.boards.resolve(b.id);
    if ((await store.listTeps()).some((t) => normalizeTepId(t.id) === tepId)) {
      origin = {
        boardDir: store.thinkubeDir,
        namespace: namespaceOfBoardDir(boardRoot, store.thinkubeDir),
      };
      break;
    }
  }
  if (!origin) throw new Error(`TEP-${tepId} not found in any repo board.`);
  if (origin.namespace === projectNamespace) {
    throw new Error(`TEP-${tepId} is already under ${projectNamespace}.`);
  }

  // Move the TEP file: <origin>/teps/TEP-id.md → <project>/teps/TEP-id.md.
  const fileName = `TEP-${tepId}.md`;
  const projectTepsDir = path.join(
    boardRoot,
    product,
    "projects",
    projectId,
    "teps",
  );
  fsSync.mkdirSync(projectTepsDir, { recursive: true });
  fsSync.renameSync(
    path.join(origin.boardDir, "teps", fileName),
    path.join(projectTepsDir, fileName),
  );

  // Sweep every board's specs; rewrite each dependent's implements: completely.
  const rewritten: string[] = [];
  for (const b of boards) {
    const store = ctx.boards.resolve(b.id);
    const specNs = namespaceOfBoardDir(boardRoot, store.thinkubeDir);
    for (const spec of await store.listSpecDirs()) {
      const rel = store.pathForSpecDoc(spec);
      const parsed = await store.getFile(rel);
      const fm = parsed?.frontmatter;
      const next = rewriteImplementsForPromote(
        specNs,
        typeof fm?.implements === "string" ? fm.implements : undefined,
        origin.namespace,
        tepId,
        projectNamespace,
      );
      if (next && parsed) {
        await store.writeFile(
          rel,
          { ...(fm ?? {}), implements: next },
          parsed.body,
        );
        rewritten.push(`SP-${spec}`);
      }
    }
  }

  return {
    ok: true,
    tep: `TEP-${tepId}`,
    movedTo: `${projectNamespace}/teps/${fileName}`,
    rewritten,
  };
}

/** Parse a slice handle (`SP-3_SL-42`) → its (spec, slice) numbers. */
function parseSliceHandle(handle: string): {
  specNumber: string;
  sliceNumber: number;
} {
  const m = SLICE_HANDLE_RE.exec(handle.trim());
  if (!m) {
    throw new Error(
      `Invalid slice handle "${handle}" — expected the form SP-{n}_SL-{m}.`,
    );
  }
  return { specNumber: m[1], sliceNumber: Number(m[2]) };
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
export async function listBoard(store: ThinkubeStore): Promise<unknown> {
  // Per-Spec requirement-hash, computed once per Spec (specs are few).
  const reqHashBySpec = new Map<string, string>();
  const specMeta = new Map<string, SpecMeta>();
  for (const specNumber of await store.listSpecDirs()) {
    const doc = await store.getFile(store.pathForSpecDoc(specNumber));
    if (doc?.body) reqHashBySpec.set(specNumber, requirementHash(doc.body));
    specMeta.set(specNumber, deriveSpecMeta(doc?.frontmatter, doc?.body));
  }

  const inputs: SliceInput[] = [];
  for (const rel of await store.listSlices()) {
    const m = SLICE_PATH_RE.exec(rel);
    if (!m) continue;
    const specNumber = m[1];
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
      tags: effectiveTags(fm),
    });
  }

  // Scope = the board's canonical id, so cross-board output is unambiguous.
  const scope = boardId(store.workspaceRoot);
  const board = buildSliceBoard(inputs, scope, specMeta);

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
        ...(card.tags?.length ? { tags: card.tags } : {}),
        // Close card (TEP-0010): present only on the auto-derived
        // `SP-{id}_accept` card, so a reader can tell it from a slice and know
        // the Spec's sign-off state — accepted/ready, slice progress, and how
        // many criteria are checked.
        ...(card.isAcceptance
          ? {
              isAcceptance: true,
              accepted: card.accepted,
              acceptReady: card.acceptReady,
              slicesDone: card.slicesDone,
              slicesTotal: card.slicesTotal,
              criteriaChecked: (card.acceptanceCriteria ?? []).filter(
                (c) => c.checked,
              ).length,
              criteriaTotal: (card.acceptanceCriteria ?? []).length,
            }
          : {}),
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
  if (!parsed) throw new Error(`No slice file at ${store.thinkubeDir}/${rel}`);
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
  if (!parsed) {
    throw new Error(`No board file at ${store.thinkubeDir}/${relativePath}`);
  }
  return { relativePath, frontmatter: parsed.frontmatter, body: parsed.body };
}

async function moveSlice(
  store: ThinkubeStore,
  handle: string,
  status: string,
  opts: { docsGateMode: DocsGateMode; docsDone?: boolean } = {
    docsGateMode: "advisory",
  },
): Promise<unknown> {
  const target = status.trim().toLowerCase() as (typeof VALID_STATUSES)[number];
  if (!VALID_STATUSES.includes(target)) {
    throw new Error(
      `Invalid status "${status}" — expected one of Ready, Doing, Done, Requires-attention.`,
    );
  }
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at ${store.thinkubeDir}/${rel}`);

  const fm: Frontmatter = { ...(parsed.frontmatter ?? {}), status: target };
  // Attest the documentation obligation (TEP-tgh6iy): a caller updating the doc
  // module in this slice passes docs_done so the gate below is satisfied.
  if (opts.docsDone === true) fm.docs_done = true;

  let baselineStamped = false;
  let gateSkipped: string | undefined;
  let docsWarning: string | undefined;
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

    // → Done docs gate (TEP-tgh6iy): a `docs: required` slice must have its docs
    // done. Blocking mode refuses (throws before any write); advisory mode lets
    // the move through but returns a warning to surface in /pair-next.
    const docsGate = gateSliceDocsToDone({
      docs: typeof fm.docs === "string" ? fm.docs : undefined,
      docsDone: fm.docs_done === true,
      mode: opts.docsGateMode,
    });
    if (!docsGate.ok) throw new Error(docsGate.reason);
    docsWarning = docsGate.warning;

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
    ...(docsWarning ? { docsWarning } : {}),
  };
}

/**
 * Record the human acceptance of a Spec — TEP-0010's single end-of-Spec gate.
 * Refuses unless every slice under the Spec is Done and every acceptance
 * criterion is checked; on success stamps `accepted:` on the Spec doc so the
 * acceptance card may enter Done and the Spec's PR merge.
 */
async function acceptSpec(
  store: ThinkubeStore,
  spec: string,
): Promise<unknown> {
  const specRel = store.pathForSpecDoc(spec);
  const specDoc = await store.getFile(specRel);
  if (!specDoc) {
    throw new Error(`No spec at ${specRel} — nothing to accept.`);
  }
  const sliceStatuses: string[] = [];
  for (const rel of await store.listSlices(spec)) {
    const parsed = await store.getFile(rel);
    sliceStatuses.push(String(parsed?.frontmatter?.status ?? ""));
  }
  const gate = gateSpecAcceptance({ specBody: specDoc.body, sliceStatuses });
  if (!gate.ok) throw new Error(gate.reason);
  const accepted = new Date().toISOString();
  await store.writeFile(
    specRel,
    { ...specDoc.frontmatter, accepted },
    specDoc.body,
  );
  return { ok: true, spec, accepted };
}

/** Card-title character limit for `create_slice` (detail belongs in the body). */
const TITLE_MAX = 70;

/**
 * Create a slice in the canonical shape (SP-4): server-allocated per-Spec
 * number (archive-aware), slug uid, frontmatter + `# title` + detail body.
 * The → Ready gate is enforced at creation time: the parent Spec must exist
 * with a non-empty `## Acceptance Criteria`.
 */
export async function createSlice(
  store: ThinkubeStore,
  args: {
    spec: string;
    title: string;
    body: string;
    depends_on?: string[];
    parallel?: boolean;
    parallel_group?: string;
    files?: string[];
    satisfies?: number[];
    work_units?: {
      footprint: string[];
      depends_on?: string[];
      execution: string;
      note?: string;
    }[];
    priority?: string;
    docs?: string;
    docs_reason?: string;
    tags?: string[];
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
  for (const wu of args.work_units ?? []) {
    if (!Array.isArray(wu?.footprint) || wu.footprint.length === 0) {
      throw new Error(
        "each work_unit needs a non-empty `footprint` (the files/objects it touches).",
      );
    }
    if (!["serial", "mechanize", "fan-out"].includes(wu.execution)) {
      throw new Error(
        `work_unit execution "${wu.execution}" must be serial | mechanize | fan-out.`,
      );
    }
  }

  // Preliminary-control gate (SP-th1ddy_SL-2): a slice's declared footprint must
  // resolve **repo-relative inside the board's own repo**. An absolute path, a
  // `..`-escaping path, or a different-repo path is structurally invalid — the
  // orchestrated worker runs from the board repo's worktree root and could never
  // legally write it, so the slice would fail orchestration *after* a run is
  // burned. Refuse it at creation, naming the offending path. Both `files:` and
  // every work_unit `footprint` are footprints, so both are checked.
  const declaredFiles = [
    ...(args.files ?? []),
    ...(args.work_units ?? []).flatMap((wu) => wu.footprint ?? []),
  ];
  if (declaredFiles.length) {
    const repoCheck = sliceFilesResolveInRepo(
      store.workspaceRoot,
      declaredFiles,
    );
    if (!repoCheck.ok) throw new Error(repoCheck.reason);
  }

  // Documentation obligation (TEP-tgh6iy). Default `required` (fail closed);
  // `n/a` must justify. The rule lives in the methodology gates module.
  const docsResult = resolveDocsObligation({
    docs: args.docs,
    docs_reason: args.docs_reason,
  });
  if (!docsResult.ok) throw new Error(docsResult.reason);

  // Creation-time → Ready gate: parent Spec present with non-empty AC.
  const specDoc = await store.getFile(store.pathForSpecDoc(args.spec));
  if (!specDoc) {
    throw new Error(
      `No spec at ${store.thinkubeDir}/specs/SP-${args.spec}/spec.md — run /spec-prepare ${args.spec} first.`,
    );
  }
  if (!hasNonEmptyAcceptanceCriteria(specDoc.body)) {
    throw new Error(
      `SP-${args.spec} has no acceptance criteria (its slices would fail the → Ready gate) — run /spec-prepare ${args.spec} first.`,
    );
  }

  // Parallel-group disjointness (SP-tgpwbm AC1): a slice joining a
  // `parallel_group` must not claim a file already owned by a sibling in that
  // group. Validate the would-be set against existing siblings before writing.
  const group = args.parallel_group?.trim();
  if (group && (args.files?.length || args.work_units?.length)) {
    const siblings: ParallelSliceInput[] = [];
    for (const rel of await store.listSlices(args.spec)) {
      const m = SLICE_PATH_RE.exec(rel);
      if (!m) continue;
      const parsed = await store.getFile(rel);
      const sfm: Frontmatter = parsed?.frontmatter ?? {};
      siblings.push({
        handle: sliceHandle(m[1], Number(m[2])),
        parallelGroup: sfm.parallel_group,
        files: sfm.files,
        workUnits: sfm.work_units,
      });
    }
    const result = validateParallelGroup([
      ...siblings,
      {
        handle: `SP-${args.spec}_SL-(new)`,
        parallelGroup: group,
        files: args.files,
        workUnits: args.work_units,
      },
    ]);
    if (!result.ok) throw new Error(result.reason);
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
  if (group) fm.parallel_group = group;
  if (args.files?.length) fm.files = args.files;
  if (args.tags?.length) fm.tags = args.tags;
  // Stamp an empty `assignee` slot the ownership arbiter later claims (SP-tgpwbm).
  fm.assignee = "";
  if (args.satisfies?.length)
    fm.satisfies = [...new Set(args.satisfies)].sort((a, b) => a - b);
  if (args.work_units?.length)
    fm.work_units = args.work_units as Frontmatter["work_units"];
  fm.docs = docsResult.value.docs;
  if (docsResult.value.docs_reason)
    fm.docs_reason = docsResult.value.docs_reason;
  // Priority is a mandatory slice attribute (always shown on the card) — default
  // to P2 (normal) when the caller doesn't triage one explicitly.
  fm.priority = (args.priority ?? "P2") as Frontmatter["priority"];

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
  spec: string,
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

/**
 * Write a Spec's `specs/SP-{id}/spec.md` into the board (the sidecar namespace),
 * creating it if absent. The board-aware write path for `/spec-prepare` (SP-tg7jnf
 * SL-4): a raw file write resolves against the session cwd (the code repo), not
 * the board, so spec authoring must go through the store like slice creation does.
 * Existing frontmatter is preserved — only the markdown body is replaced.
 */
async function writeSpec(
  store: ThinkubeStore,
  spec: string,
  body: string,
  implementsRef?: string,
  acVerifications?: Record<string, unknown>,
): Promise<unknown> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Spec body must not be empty.");
  const rel = store.pathForSpecDoc(spec);
  const existing = await store.getFile(rel);
  const fm: Frontmatter = { ...(existing?.frontmatter ?? {}) };
  // `implements:` is settable (TEP-tgvwct follow-up): a bare `TEP-<id>` or a
  // qualified `<namespace>:TEP-<id>` (umbrella). Omitted → preserved; empty → cleared.
  if (implementsRef !== undefined) {
    const v = implementsRef.trim();
    if (v) fm.implements = v;
    else delete fm.implements;
  }
  // `ac_verifications:` — the closing gate's per-AC declaration (SP-tgzyfy). Normalized to a map
  // keyed by the AC ordinal → { run, env? }; omitted → preserved, `{}` → cleared. Invalid entries
  // (no non-empty `run`, non-positive ordinal) are dropped so a malformed map can't poison the gate.
  if (acVerifications !== undefined) {
    const normalized = normalizeAcVerifications(acVerifications);
    if (Object.keys(normalized).length) fm.ac_verifications = normalized;
    else delete fm.ac_verifications;
  }
  await store.writeFile(rel, fm, `${trimmed}\n`);
  return {
    ok: true,
    spec,
    relativePath: rel,
    created: existing === undefined,
    implements: fm.implements,
    acVerifications: fm.ac_verifications,
  };
}

/**
 * `patch_spec_section` (SP-th1ddy) — replace exactly one named section of an
 * existing Spec's body via the pure `sectionPatch` helper, leaving every other
 * section byte-identical, and write the whole body back through
 * `ThinkubeStore.writeFile` so the secret scan applies (the only board-write
 * boundary — no second write path). Frontmatter is preserved untouched. This is
 * the surgical single-section edit that replaces the model's
 * read-modify-write-whole-body dance; `write_spec` still replaces the full body.
 */
export async function patchSpecSection(
  store: ThinkubeStore,
  spec: string,
  section: string,
  content: string,
): Promise<unknown> {
  const rel = store.pathForSpecDoc(spec);
  const existing = await store.getFile(rel);
  if (!existing) {
    throw new Error(
      `No spec document at ${store.thinkubeDir}/${rel} — create it with write_spec first.`,
    );
  }
  const nextBody = sectionPatch(existing.body, section, content);
  // Route through the store's safe-write path so the secret scan refuses a
  // planted secret — never a raw fs write (Constraint: one write boundary).
  await store.writeFile(rel, existing.frontmatter, nextBody);
  return {
    ok: true,
    spec,
    section,
    relativePath: rel,
  };
}

/** Normalize a raw `ac_verifications` map (AC ordinal → declaration) into the canonical
 *  `{ run, env? }` frontmatter shape, dropping entries without a non-empty `run` or a positive
 *  integer ordinal, and sorting the keys by ordinal for a stable, low-diff write. */
function normalizeAcVerifications(
  raw: Record<string, unknown>,
): Record<string, { run: string; env?: "cluster" | "local" }> {
  const entries: [number, { run: string; env?: "cluster" | "local" }][] = [];
  for (const [key, val] of Object.entries(raw)) {
    const ac = Number(key);
    if (!Number.isInteger(ac) || ac <= 0) continue;
    if (!val || typeof val !== "object") continue;
    const run = (val as Record<string, unknown>).run;
    if (typeof run !== "string" || !run.trim()) continue;
    const env = (val as Record<string, unknown>).env;
    entries.push([
      ac,
      {
        run: run.trim(),
        ...(env === "cluster" || env === "local" ? { env } : {}),
      },
    ]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  const out: Record<string, { run: string; env?: "cluster" | "local" }> = {};
  for (const [ac, decl] of entries) out[String(ac)] = decl;
  return out;
}

export async function updateSlice(
  store: ThinkubeStore,
  handle: string,
  body: string,
  tags?: string[],
): Promise<unknown> {
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at ${store.thinkubeDir}/${rel}`);

  // Tags are settable/replaceable via update (SP-tgvil2): when provided, set the
  // `tags` frontmatter (an empty array clears them); omitted → frontmatter as-is.
  const nextFm: Frontmatter | undefined =
    tags === undefined
      ? parsed.frontmatter
      : { ...(parsed.frontmatter ?? {}), tags };

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

  await store.writeFile(rel, nextFm, nextBody);
  return {
    ok: true,
    slice: store.sliceHandle(specNumber, sliceNumber),
    relativePath: rel,
    titleReattached,
  };
}

/**
 * Write a TEP into the board (TEP-0009) — the board-aware path for `/tep`.
 * Omit `tep` to mint a conflict-free base36-epoch id; pass it to update an
 * existing one. On create the body defaults to the `TEP-TEMPLATE.md` scaffold
 * and canonical frontmatter is filled; on update existing frontmatter is
 * preserved (only `title`/`status` are overlaid).
 */
export async function writeTep(
  store: ThinkubeStore,
  args: {
    tep?: string;
    title?: string;
    status?: string;
    body?: string;
    tags?: string[];
  },
): Promise<unknown> {
  const provided = args.tep?.trim().replace(/^TEP-/i, "");
  const tepId =
    provided && provided.length ? provided : await store.nextTepId();
  const rel = store.pathForTep(tepId);
  const existing = await store.getFile(rel);

  // Body: explicit > existing > template scaffold (create only).
  let body = args.body?.trim();
  if (!body) {
    if (existing?.body) body = existing.body;
    else {
      const tmpl = await store.getFile(store.pathForTep("TEMPLATE"));
      body = tmpl?.body ?? `# TEP-${tepId} — <title>\n`;
    }
  }

  // Frontmatter: preserve on update; scaffold canonical fields on create.
  const fm: Frontmatter = existing?.frontmatter
    ? { ...existing.frontmatter }
    : {
        kind: "tep",
        id: `TEP-${tepId}`,
        status: "proposed",
        created: new Date().toISOString().slice(0, 10),
        implemented_by: [],
      };
  if (!fm.kind) fm.kind = "tep";
  if (!fm.id) fm.id = `TEP-${tepId}`;
  if (args.title) fm.title = args.title;
  if (args.status) fm.status = args.status as Frontmatter["status"];
  if (args.tags?.length) fm.tags = args.tags;

  await store.writeFile(rel, fm, body.endsWith("\n") ? body : `${body}\n`);
  return {
    ok: true,
    tep: `TEP-${tepId}`,
    relativePath: rel,
    created: existing === undefined,
  };
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
    name: "A board file",
    description:
      "Read a specific board markdown file from this session's own repo. Substitute `{path}` with the path relative to the board directory (the sidecar namespace).",
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
// Guard on `require.main === module` so importing this module (e.g. a unit test
// exercising the exported handlers) does NOT boot the stdio server; only a
// direct `node kanbanMcpServer.js` launch (the .mcp.json entry) starts it.
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(
      `[thinkube-mcp] startup failed: ${(err as Error).stack ?? err}\n`,
    );
    process.exit(1);
  });
}
