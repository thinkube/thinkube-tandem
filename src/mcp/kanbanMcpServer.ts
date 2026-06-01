#!/usr/bin/env node
// MUST be the first import: installs the require-hook that redirects
// `require('vscode')` to our subprocess stub. See `installVscodeStub.ts`.
import "./installVscodeStub";

/**
 * Stdio MCP server for the Thinkube methodology kanban.
 *
 * Launched as a subprocess by `KanbanMcpProvider` via VS Code's MCP server
 * definition mechanism. Talks the standard MCP protocol over stdio so any
 * MCP client (Claude Code chat, mcp-inspector, etc.) can drive the same
 * surface the panels use.
 *
 * State plumbing: this is a separate Node process, so settings + auth come
 * in via environment variables set by the provider:
 *
 *   THINKUBE_WORKSPACE        absolute path to the workspace root
 *   THINKUBE_REPO             "owner/name"
 *   THINKUBE_PROJECT_NUMBER   Projects v2 number ("0" disables project tools)
 *   THINKUBE_ALLOW_AI_WRITES  "true" | "false" — gates every mutating tool
 *   GITHUB_TOKEN              resolved by the host's AuthService
 *
 * The subprocess re-uses `GitHubService` and `ThinkubeStore` from the same
 * compiled TypeScript. AuthService is constructed with a stub context so
 * the `process.env.GITHUB_TOKEN` lookup runs unchanged (no SecretStorage,
 * no `gh` shell-out — host already resolved a token before launching us).
 *
 * Logging: stderr only. VS Code captures it under the MCP server's output
 * channel; never print to stdout — that channel is the protocol stream.
 */
import * as vscode from "vscode";

import { AuthService } from "../github/AuthService";
import { GitHubService, RepoCoords } from "../github/GitHubService";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { TasksMaterializer } from "../methodology/TasksMaterializer";

interface ServerEnv {
  workspace: string;
  coords: RepoCoords;
  projectNumber: number;
  allowAIWrites: boolean;
}

function readEnv(): ServerEnv {
  const workspace = process.env.THINKUBE_WORKSPACE ?? "";
  if (!workspace) die("THINKUBE_WORKSPACE not set");

  const repoSpec = (process.env.THINKUBE_REPO ?? "").trim();
  if (!repoSpec.includes("/")) die("THINKUBE_REPO must be owner/name");
  const [owner, name] = repoSpec.split("/", 2);
  if (!owner || !name) die("THINKUBE_REPO must be owner/name");

  const projectNumber = Number(process.env.THINKUBE_PROJECT_NUMBER ?? "0");
  const allowAIWrites =
    (process.env.THINKUBE_ALLOW_AI_WRITES ?? "true").toLowerCase() === "true";

  return { workspace, coords: { owner, name }, projectNumber, allowAIWrites };
}

function die(msg: string): never {
  process.stderr.write(`[thinkube-mcp] fatal: ${msg}\n`);
  process.exit(2);
}

function log(msg: string): void {
  process.stderr.write(`[thinkube-mcp] ${msg}\n`);
}

/**
 * Stub vscode.ExtensionContext that satisfies AuthService's needs without
 * VS Code. AuthService only touches `context.secrets` after env + `gh auth`
 * lookups fail; since the host passes GITHUB_TOKEN in env, the secrets path
 * is dead in this subprocess. The stub returns undefined for everything.
 */
function makeStubContext(): vscode.ExtensionContext {
  const noop = async () => {};
  return {
    secrets: {
      get: async () => undefined,
      store: noop,
      delete: noop,
      onDidChange: () => ({ dispose: noop }),
    },
  } as unknown as vscode.ExtensionContext;
}

async function main(): Promise<void> {
  const env = readEnv();
  log(
    `booting: ${env.coords.owner}/${env.coords.name} project=${env.projectNumber} writes=${env.allowAIWrites}`,
  );

  // Build the same service stack the UI uses.
  const auth = new AuthService(makeStubContext());
  const github = new GitHubService(auth);
  const store = new ThinkubeStore(env.workspace);
  const materializer = new TasksMaterializer({
    github,
    store,
    // ThinkubeStore.writeFile needs to scan-for-secrets; outputs go to
    // stderr in this subprocess. The OutputChannel-shaped object below
    // routes appendLine() to the log stream.
    output: { appendLine: (s: string) => log(s) } as vscode.OutputChannel,
  });

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

  const ctx: HandlerContext = { env, github, store, materializer };
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
  github: GitHubService;
  store: ThinkubeStore;
  materializer: TasksMaterializer;
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
    name: "list_epics",
    description: "List all open Epic issues in the configured repo.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_stories_in_epic",
    description: "Sub-issues of an Epic (Stories).",
    inputSchema: {
      type: "object",
      properties: {
        epic_number: { type: "integer", description: "Epic issue number" },
      },
      required: ["epic_number"],
      additionalProperties: false,
    },
  },
  {
    name: "list_specs_in_story",
    description: "Sub-issues of a Story (Specs).",
    inputSchema: {
      type: "object",
      properties: {
        story_number: { type: "integer", description: "Story issue number" },
      },
      required: ["story_number"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tasks_in_spec",
    description:
      "Sub-issues of a Spec (Tasks — these are the kanban contents).",
    inputSchema: {
      type: "object",
      properties: {
        spec_number: { type: "integer", description: "Spec issue number" },
      },
      required: ["spec_number"],
      additionalProperties: false,
    },
  },
  {
    name: "list_board",
    description:
      "Current kanban state from Projects v2. Returns items grouped by Status column.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_issue",
    description:
      "Full issue details (title, body, state, labels) and the linked .thinkube/ file if any.",
    inputSchema: {
      type: "object",
      properties: { number: { type: "integer", description: "Issue number" } },
      required: ["number"],
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
    name: "create_epic",
    description:
      "Create an Epic issue + `.thinkube/epics/EP-{n}.md`. Returns the new issue.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string", description: "One-paragraph pitch" },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "create_story_under_epic",
    description:
      "Create a Story issue under an Epic + `.thinkube/stories/ST-{n}.md`, linked as sub-issue.",
    inputSchema: {
      type: "object",
      properties: {
        epic_number: { type: "integer" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["epic_number", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "create_spec_under_story",
    description:
      "Create a Spec issue under a Story + `.thinkube/specs/SP-{n}.md`, linked as sub-issue.",
    inputSchema: {
      type: "object",
      properties: {
        story_number: { type: "integer" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["story_number", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "create_tasks_from_spec",
    description:
      "Read `.thinkube/specs/SP-{n}-tasks.md` and materialise unchecked rows as Task issues + Projects v2 items in Ready. Idempotent.",
    inputSchema: {
      type: "object",
      properties: { spec_number: { type: "integer" } },
      required: ["spec_number"],
      additionalProperties: false,
    },
  },
  {
    name: "move_task",
    description:
      "Change a Task's Projects v2 Status column. Column must match one of: Spec, Ready, In Progress, Review, Verify, Done.",
    inputSchema: {
      type: "object",
      properties: {
        task_number: { type: "integer" },
        status: {
          type: "string",
          enum: ["Spec", "Ready", "In Progress", "Review", "Verify", "Done"],
        },
      },
      required: ["task_number", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "update_issue",
    description: "Update title / body / labels / state on any issue.",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "integer" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        state: { type: "string", enum: ["open", "closed"] },
      },
      required: ["number"],
      additionalProperties: false,
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to any issue.",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "integer" },
        body: { type: "string" },
      },
      required: ["number", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "close_issue",
    description: "Close an issue with optional reason.",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "integer" },
        reason: { type: "string", enum: ["completed", "not_planned"] },
      },
      required: ["number"],
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
  {
    name: "decompose_spec",
    description:
      "Bridge: the bundle's `/tasks-decompose` skill is the canonical author of `SP-{n}-tasks.md`. This tool returns instructions on how to invoke it; it does not generate the file itself (that's the methodology bundle's job).",
    inputSchema: {
      type: "object",
      properties: { spec_number: { type: "integer" } },
      required: ["spec_number"],
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
    case "list_epics":
      return ctx.github.listIssues(ctx.env.coords, {
        type: "epic",
        state: "open",
      });
    case "list_stories_in_epic":
      return ctx.github.listSubIssues(
        ctx.env.coords,
        asInt(args, "epic_number"),
      );
    case "list_specs_in_story":
      return ctx.github.listSubIssues(
        ctx.env.coords,
        asInt(args, "story_number"),
      );
    case "list_tasks_in_spec":
      return ctx.github.listSubIssues(
        ctx.env.coords,
        asInt(args, "spec_number"),
      );
    case "list_board":
      return listBoard(ctx);
    case "get_issue":
      return getIssue(ctx, asInt(args, "number"));
    case "get_thinkube_file":
      return getThinkubeFile(ctx, asString(args, "relative_path"));
    case "create_epic":
      writeGate(name);
      return createIssueOfKind(
        ctx,
        "epic",
        undefined,
        asString(args, "title"),
        optString(args, "body"),
      );
    case "create_story_under_epic":
      writeGate(name);
      return createIssueOfKind(
        ctx,
        "story",
        asInt(args, "epic_number"),
        asString(args, "title"),
        optString(args, "body"),
      );
    case "create_spec_under_story":
      writeGate(name);
      return createIssueOfKind(
        ctx,
        "spec",
        asInt(args, "story_number"),
        asString(args, "title"),
        optString(args, "body"),
      );
    case "create_tasks_from_spec":
      writeGate(name);
      return ctx.materializer.materialize({
        specIssueNumber: asInt(args, "spec_number"),
      });
    case "move_task":
      writeGate(name);
      return moveTask(
        ctx,
        asInt(args, "task_number"),
        asString(args, "status"),
      );
    case "update_issue":
      writeGate(name);
      return ctx.github.updateIssue(ctx.env.coords, asInt(args, "number"), {
        title: optString(args, "title"),
        body: optString(args, "body"),
        labels: optStringArray(args, "labels"),
        state: optEnum(args, "state", ["open", "closed"]) as
          | "open"
          | "closed"
          | undefined,
      });
    case "add_comment":
      writeGate(name);
      await ctx.github.addComment(
        ctx.env.coords,
        asInt(args, "number"),
        asString(args, "body"),
      );
      return { ok: true };
    case "close_issue":
      writeGate(name);
      await ctx.github.closeIssue(
        ctx.env.coords,
        asInt(args, "number"),
        optEnum(args, "reason", ["completed", "not_planned"]) as
          | "completed"
          | "not_planned"
          | undefined,
      );
      return { ok: true };
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
    case "decompose_spec":
      return decomposeSpecHint(ctx, asInt(args, "spec_number"));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ─── Tool implementations ───────────────────────────────────────────────────

async function listBoard(ctx: HandlerContext): Promise<unknown> {
  if (ctx.env.projectNumber === 0) {
    return {
      error:
        "No Projects v2 project configured (thinkube.kanban.projectNumber=0).",
    };
  }
  const project = await ctx.github.getProject(
    ctx.env.coords.owner,
    ctx.env.projectNumber,
  );
  const items = await ctx.github.listProjectItems(project.id);
  const groups: Record<
    string,
    Array<{ number: number; title: string; url: string }>
  > = {};
  for (const it of items) {
    if (!it.issue) continue;
    const col = it.status ?? "(unassigned)";
    (groups[col] ??= []).push({
      number: it.issue.number,
      title: it.issue.title,
      url: it.issue.url,
    });
  }
  return {
    project: { id: project.id, number: project.number, title: project.title },
    groups,
  };
}

async function getIssue(ctx: HandlerContext, number: number): Promise<unknown> {
  const issue = await ctx.github.getIssue(ctx.env.coords, number);
  const linked = await ctx.store.linkIssueToFile(number).catch(() => undefined);
  let file:
    | { relativePath: string; frontmatter: unknown; body: string }
    | undefined;
  if (linked) {
    const parsed = await ctx.store.getFile(linked);
    if (parsed)
      file = {
        relativePath: linked,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
      };
  }
  return { issue, linkedFile: file };
}

async function getThinkubeFile(
  ctx: HandlerContext,
  relativePath: string,
): Promise<unknown> {
  const parsed = await ctx.store.getFile(relativePath);
  if (!parsed) throw new Error(`No file at .thinkube/${relativePath}`);
  return { relativePath, frontmatter: parsed.frontmatter, body: parsed.body };
}

async function createIssueOfKind(
  ctx: HandlerContext,
  kind: "epic" | "story" | "spec",
  parentNumber: number | undefined,
  title: string,
  body: string | undefined,
): Promise<unknown> {
  const issue = await ctx.github.createIssue(ctx.env.coords, {
    type: kind,
    title,
    body: body ?? "",
  });
  if (parentNumber !== undefined) {
    const parent = await ctx.github.getIssue(ctx.env.coords, parentNumber);
    try {
      await ctx.github.addSubIssue(parent.nodeId, issue.nodeId);
    } catch (err) {
      log(
        `createIssueOfKind: addSubIssue failed (non-fatal): ${(err as Error).message}`,
      );
    }
  }
  // Write the sidecar .thinkube file.
  const rel = ctx.store.pathFor(kind, issue.number);
  const frontmatter: Record<string, unknown> = {
    kind,
    issue: issue.number,
    repo: `${ctx.env.coords.owner}/${ctx.env.coords.name}`,
    created: new Date().toISOString().slice(0, 10),
  };
  if (parentNumber !== undefined) frontmatter.parent_issue = parentNumber;
  const fileBody = `# ${title}\n\n${body ?? ""}\n`;
  try {
    await ctx.store.writeFile(rel, frontmatter, fileBody);
  } catch (err) {
    log(
      `createIssueOfKind: writeFile failed (non-fatal): ${(err as Error).message}`,
    );
  }
  return { issue, relativePath: rel };
}

async function moveTask(
  ctx: HandlerContext,
  taskNumber: number,
  status: string,
): Promise<unknown> {
  if (ctx.env.projectNumber === 0) {
    throw new Error(
      "No Projects v2 project configured (thinkube.kanban.projectNumber=0).",
    );
  }
  const project = await ctx.github.getProject(
    ctx.env.coords.owner,
    ctx.env.projectNumber,
  );
  const option = project.statusField?.options.find((o) => o.name === status);
  if (!project.statusField || !option) {
    throw new Error(`Status field is missing the option "${status}".`);
  }
  const items = await ctx.github.listProjectItems(project.id);
  const item = items.find((i) => i.issue?.number === taskNumber);
  if (!item) {
    throw new Error(`Task #${taskNumber} is not on the project board.`);
  }
  await ctx.github.setStatus(
    project.id,
    item.id,
    project.statusField.id,
    option.id,
  );
  return { ok: true, taskNumber, status };
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
    repo: `${ctx.env.coords.owner}/${ctx.env.coords.name}`,
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
    repo: `${ctx.env.coords.owner}/${ctx.env.coords.name}`,
    status: "active" as const,
    created: date,
  };
  const previous = existing?.body ?? "";
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const appended = `${previous.trimEnd()}\n\n## ${stamp}\n\n${body}\n`;
  await ctx.store.writeFile(rel, frontmatter, appended);
  return { relativePath: rel };
}

function decomposeSpecHint(ctx: HandlerContext, specNumber: number): unknown {
  return {
    message:
      "decompose_spec doesn't generate the tasks file directly — the methodology bundle's `/tasks-decompose` skill does. Invoke that skill in your Claude session against the spec, then call `create_tasks_from_spec` once the file lands.",
    relativeTasksPath: ctx.store.pathForTasks(specNumber),
    nextStep: `/tasks-decompose ${specNumber}`,
  };
}

// ─── Resource definitions + reader ──────────────────────────────────────────

const RESOURCE_DEFS = [
  {
    uri: "thinkube://board_state",
    name: "Board state",
    description: "Current Projects v2 board: items grouped by Status column.",
    mimeType: "application/json",
  },
  {
    uri: "thinkube://roadmap",
    name: "Roadmap",
    description: "Tree of Epic → Story → Spec.",
    mimeType: "application/json",
  },
  {
    uri: "thinkube://issue/{number}",
    name: "Issue + linked file",
    description:
      "Issue details plus the linked .thinkube/*.md file (if any). Substitute `{number}` with an issue number.",
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
  if (uri === "thinkube://roadmap") {
    return JSON.stringify(await buildRoadmap(ctx), null, 2);
  }
  const issueMatch = /^thinkube:\/\/issue\/(\d+)$/.exec(uri);
  if (issueMatch) {
    return JSON.stringify(await getIssue(ctx, Number(issueMatch[1])), null, 2);
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

async function buildRoadmap(ctx: HandlerContext): Promise<unknown> {
  const epics = await ctx.github.listIssues(ctx.env.coords, {
    type: "epic",
    state: "open",
  });
  return Promise.all(
    epics.map(async (epic) => {
      const stories = await ctx.github.listSubIssues(
        ctx.env.coords,
        epic.number,
      );
      const trees = await Promise.all(
        stories.map(async (story) => {
          const specs = await ctx.github.listSubIssues(
            ctx.env.coords,
            story.number,
          );
          return {
            number: story.number,
            title: story.title,
            url: story.url,
            specs: specs.map((s) => ({
              number: s.number,
              title: s.title,
              url: s.url,
            })),
          };
        }),
      );
      return {
        number: epic.number,
        title: epic.title,
        url: epic.url,
        stories: trees,
      };
    }),
  );
}

// ─── Argument coercion ──────────────────────────────────────────────────────

function asInt(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(`argument ${key} must be an integer`);
  }
  return v;
}

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
  return typeof v === "string" ? v : undefined;
}

function optStringArray(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = args[key];
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string");
}

function optEnum(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): string | undefined {
  const v = args[key];
  if (typeof v !== "string") return undefined;
  return allowed.includes(v) ? v : undefined;
}
