#!/usr/bin/env node
// MUST be the first import: installs the require-hook that redirects
// `require('vscode')` to our subprocess stub. See `installVscodeStub.ts`.
import "./installVscodeStub";

/**
 * Stdio MCP server for the Thinkube methodology kanban (files-first / Tandem).
 *
 * Launched as a subprocess by `KanbanMcpProvider` via VS Code's MCP server
 * definition mechanism. Talks the standard MCP protocol over stdio so any
 * MCP client (Claude Code chat, mcp-inspector, etc.) can drive the same
 * surface the panels render.
 *
 * Source of truth: the committed `.thinkube/specs/SP-{n}/SL-{m}.md` slice
 * files (and the parent `SP-{n}/spec.md` documents). There is NO GitHub here —
 * this server reads and writes only through `ThinkubeStore` and projects the
 * board with the same pure `sliceBoard.ts` logic the panel uses, so the MCP
 * surface and the kanban panel always agree.
 *
 * State plumbing: this is a separate Node process, so settings come in via
 * environment variables set by the provider:
 *
 *   THINKUBE_WORKSPACE        absolute path to the workspace root (the
 *                             `.thinkube` parent)
 *   THINKUBE_ALLOW_AI_WRITES  "true" | "false" — gates every mutating tool
 *
 * Logging: stderr only. VS Code captures it under the MCP server's output
 * channel; never print to stdout — that channel is the protocol stream.
 */
import { requirementHash } from "../methodology/specChange";
import { ThinkubeStore } from "../store/ThinkubeStore";
import type { Frontmatter } from "../store/frontmatter";
import {
  buildSliceBoard,
  SliceInput,
  sliceHandle,
} from "../views/kanban/host/storage/sliceBoard";

interface ServerEnv {
  workspace: string;
  allowAIWrites: boolean;
}

function readEnv(): ServerEnv {
  const workspace = process.env.THINKUBE_WORKSPACE ?? "";
  if (!workspace) die("THINKUBE_WORKSPACE not set");

  const allowAIWrites =
    (process.env.THINKUBE_ALLOW_AI_WRITES ?? "true").toLowerCase() === "true";

  return { workspace, allowAIWrites };
}

function die(msg: string): never {
  process.stderr.write(`[thinkube-mcp] fatal: ${msg}\n`);
  process.exit(2);
}

function log(msg: string): void {
  process.stderr.write(`[thinkube-mcp] ${msg}\n`);
}

async function main(): Promise<void> {
  const env = readEnv();
  log(`booting: workspace=${env.workspace} writes=${env.allowAIWrites}`);

  const store = new ThinkubeStore(env.workspace);

  // Dynamic import: the MCP SDK is ESM-only, this entrypoint is CJS.
  const sdkServer: any =
    await import("@modelcontextprotocol/sdk/server/index.js");
  const sdkStdio: any =
    await import("@modelcontextprotocol/sdk/server/stdio.js");
  const sdkTypes: any = await import("@modelcontextprotocol/sdk/types.js");

  const server = new sdkServer.Server(
    { name: "thinkube-kanban", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  const ctx: HandlerContext = { env, store };
  registerHandlers(server, sdkTypes, ctx);

  const transport = new sdkStdio.StdioServerTransport();
  await server.connect(transport);
  log("connected");
}

main().catch((err) => {
  process.stderr.write(
    `[thinkube-mcp] startup failed: ${(err as Error).stack ?? err}\n`,
  );
  process.exit(1);
});

// ─── Handlers ───────────────────────────────────────────────────────────────

interface HandlerContext {
  env: ServerEnv;
  store: ThinkubeStore;
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

const TOOL_DEFS = [
  {
    name: "list_board",
    description:
      "Current Tandem board, projected from the committed `.thinkube/specs/SP-{n}/SL-{m}.md` slice files. Returns the Ready / Doing / Done columns; each card carries its slice handle (`id`, e.g. `SP-3_SL-42`), title (`description`), and `specStale` / `specChange` (whether the parent Spec's requirements changed since the slice was last verified).",
    inputSchema: {
      type: "object",
      properties: {},
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
      },
      required: ["relative_path"],
      additionalProperties: false,
    },
  },
  {
    name: "move_slice",
    description:
      "Move a slice to a different column by setting its `status:` frontmatter. Status must be one of: Ready, Doing, Done. Moving to Done stamps the slice's `verified_req_hash` from the parent Spec so a later requirement edit re-flags it stale.",
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
      },
      required: ["slice", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "update_slice",
    description:
      "Replace a slice's markdown body (frontmatter is preserved). The slice's title is its body's first heading/line.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description: "Slice handle, e.g. `SP-3_SL-42`.",
        },
        body: { type: "string" },
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
      properties: { body: { type: "string" } },
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
  switch (name) {
    case "list_board":
      return listBoard(ctx);
    case "get_slice":
      return getSlice(ctx, asString(args, "slice"));
    case "get_thinkube_file":
      return getThinkubeFile(ctx, asString(args, "relative_path"));
    case "move_slice":
      writeGate(name);
      return moveSlice(ctx, asString(args, "slice"), asString(args, "status"));
    case "update_slice":
      writeGate(name);
      return updateSlice(ctx, asString(args, "slice"), asString(args, "body"));
    case "write_decision":
      writeGate(name);
      return writeDecision(
        ctx,
        asString(args, "title"),
        asString(args, "body"),
      );
    case "write_retro_note":
      writeGate(name);
      return writeRetroNote(ctx, asString(args, "body"));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ─── Tool implementations ───────────────────────────────────────────────────

const SLICE_PATH_RE = /specs\/SP-(\d+)\/SL-(\d+)\.md$/;
const SLICE_HANDLE_RE = /^SP-(\d+)_SL-(\d+)$/;
const VALID_STATUSES = ["ready", "doing", "done"] as const;

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

/** Card title = the slice body's first non-empty line (heading marker stripped). */
function sliceTitle(body: string | undefined, fallback: string): string {
  if (!body) return fallback;
  for (const line of body.split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, "").trim();
    if (t) return t;
  }
  return fallback;
}

/**
 * Project the committed slice files into the Tandem board. Mirrors
 * `ThinkubeFilesAdapter.load()`'s read loop (we don't instantiate the adapter —
 * it builds a vscode EventEmitter, and this subprocess only has a vscode stub).
 */
async function listBoard(ctx: HandlerContext): Promise<unknown> {
  // Per-Spec requirement-hash, computed once per Spec (specs are few).
  const reqHashBySpec = new Map<number, string>();
  for (const specNumber of await ctx.store.listSpecDirs()) {
    const doc = await ctx.store.getFile(ctx.store.pathForSpecDoc(specNumber));
    if (doc?.body) reqHashBySpec.set(specNumber, requirementHash(doc.body));
  }

  const inputs: SliceInput[] = [];
  for (const rel of await ctx.store.listSlices()) {
    const m = SLICE_PATH_RE.exec(rel);
    if (!m) continue;
    const specNumber = Number(m[1]);
    const sliceNumber = Number(m[2]);
    const parsed = await ctx.store.getFile(rel);
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

  const scope = pathBasename(ctx.store.workspaceRoot) || "Tandem board";
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

async function getSlice(ctx: HandlerContext, handle: string): Promise<unknown> {
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = ctx.store.pathForSlice(specNumber, sliceNumber);
  const parsed = await ctx.store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at .thinkube/${rel}`);
  return {
    handle: ctx.store.sliceHandle(specNumber, sliceNumber),
    relativePath: rel,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}

async function getThinkubeFile(
  ctx: HandlerContext,
  relativePath: string,
): Promise<unknown> {
  const parsed = await ctx.store.getFile(relativePath);
  if (!parsed) throw new Error(`No file at .thinkube/${relativePath}`);
  return { relativePath, frontmatter: parsed.frontmatter, body: parsed.body };
}

async function moveSlice(
  ctx: HandlerContext,
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
  const rel = ctx.store.pathForSlice(specNumber, sliceNumber);
  const parsed = await ctx.store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at .thinkube/${rel}`);

  const fm: Frontmatter = { ...(parsed.frontmatter ?? {}), status: target };

  // On move to Done, stamp the verification baseline: read the parent Spec
  // doc, hash its requirement sections, and record it on the slice so a later
  // requirement edit re-flags this slice stale. Best-effort — never fail the
  // move on a hashing/read error.
  let baselineStamped = false;
  if (target === "done") {
    try {
      const doc = await ctx.store.getFile(ctx.store.pathForSpecDoc(specNumber));
      if (doc?.body) {
        fm.verified_req_hash = requirementHash(doc.body);
        baselineStamped = true;
      }
    } catch (err) {
      process.stderr.write(
        `[thinkube-mcp] move_slice: baseline stamp for ${handle} failed: ${(err as Error).message}\n`,
      );
    }
  }

  await ctx.store.writeFile(rel, fm, parsed.body);
  return {
    ok: true,
    slice: ctx.store.sliceHandle(specNumber, sliceNumber),
    status: target,
    baselineStamped,
  };
}

async function updateSlice(
  ctx: HandlerContext,
  handle: string,
  body: string,
): Promise<unknown> {
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = ctx.store.pathForSlice(specNumber, sliceNumber);
  const parsed = await ctx.store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at .thinkube/${rel}`);
  await ctx.store.writeFile(rel, parsed.frontmatter, body);
  return {
    ok: true,
    slice: ctx.store.sliceHandle(specNumber, sliceNumber),
    relativePath: rel,
  };
}

async function writeDecision(
  ctx: HandlerContext,
  title: string,
  body: string,
): Promise<unknown> {
  // Find the next ADR number — list existing decisions, pick max + 1.
  const existing = await ctx.store.listKind("decision");
  const max = existing
    .map((p) => /ADR-(\d+)\.md$/.exec(p))
    .map((m) => (m ? Number(m[1]) : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const n = max + 1;
  const rel = ctx.store.pathFor("decision", n);
  const frontmatter = {
    kind: "decision" as const,
    status: "active" as const,
    created: new Date().toISOString().slice(0, 10),
  };
  const fileBody = `# ${title}\n\n${body}\n`;
  await ctx.store.writeFile(rel, frontmatter, fileBody);
  return { relativePath: rel, number: n };
}

async function writeRetroNote(
  ctx: HandlerContext,
  body: string,
): Promise<unknown> {
  const date = new Date().toISOString().slice(0, 10);
  const rel = ctx.store.pathFor("retro", date);
  const existing = await ctx.store.getFile(rel);
  const frontmatter = existing?.frontmatter ?? {
    kind: "retro" as const,
    status: "active" as const,
    created: date,
  };
  const previous = existing?.body ?? "";
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const appended = `${previous.trimEnd()}\n\n## ${stamp}\n\n${body}\n`;
  await ctx.store.writeFile(rel, frontmatter, appended);
  return { relativePath: rel };
}

// ─── Resource definitions + reader ──────────────────────────────────────────

const RESOURCE_DEFS = [
  {
    uri: "thinkube://board_state",
    name: "Board state",
    description:
      "Current Tandem board: the Ready / Doing / Done columns projected from the committed slice files.",
    mimeType: "application/json",
  },
  {
    uri: "thinkube://thinkube_file/{path}",
    name: "A .thinkube file",
    description:
      "Read a specific `.thinkube/*.md` file. Substitute `{path}` with the relative path.",
    mimeType: "application/json",
  },
];

async function readResource(uri: string, ctx: HandlerContext): Promise<string> {
  if (uri === "thinkube://board_state") {
    return JSON.stringify(await listBoard(ctx), null, 2);
  }
  const fileMatch = /^thinkube:\/\/thinkube_file\/(.+)$/.exec(uri);
  if (fileMatch) {
    return JSON.stringify(
      await getThinkubeFile(ctx, decodeURIComponent(fileMatch[1])),
      null,
      2,
    );
  }
  throw new Error(`unknown resource: ${uri}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Last path segment, `/`- or `\`-delimited (no node:path import needed). */
function pathBasename(p: string): string {
  const parts = p.split(/[/\\]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function asString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string")
    throw new Error(`argument ${key} must be a string`);
  return v;
}
