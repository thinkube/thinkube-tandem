/**
 * Runtime config resolution for the kanban MCP server.
 *
 * The server historically got its config from `THINKUBE_*` env injected into
 * each repo's `.mcp.json` by the extension. When the server ships *inside the
 * plugin* (`node ${CLAUDE_PLUGIN_ROOT}/mcp/kanban.js`) there is no per-repo env
 * injection, so config must be discovered. Precedence (highest first):
 *
 *   1. explicit `THINKUBE_*` env   (back-compat — per-repo `.mcp.json` still works)
 *   2. a machine-level config file (`<CLAUDE_CONFIG_DIR>/thinkube-mcp.json`,
 *      written by the extension on activation from `thinkube.thinkingSpace.root`)
 *   3. defaults / cwd discovery    (ThinkingSpaceRegistry already appends the cwd thinking space)
 *
 * Pure (no fs / vscode) → unit-tested. The caller reads the file and passes the
 * parsed object (or null on missing/unparseable).
 */

export type DocsGateMode = "advisory" | "blocking";

export interface WorkspaceFolderRef {
  name: string;
  path: string;
}

/** Machine-level config file shape (a subset; all fields optional). */
export interface ServerConfigFile {
  thinkingSpaceRoot?: string;
  folders?: WorkspaceFolderRef[];
  roots?: string[];
  allowAIWrites?: boolean;
}

export interface ResolvedServerConfig {
  roots: string[];
  folders: WorkspaceFolderRef[];
  thinkingSpaceRoot?: string;
  allowAIWrites: boolean;
  docsGateMode: DocsGateMode;
  /** Model for the write_spec certification auditor (judgment gate). */
  auditorModel: string;
  legacyWorkspace?: string;
}

type Env = Record<string, string | undefined>;

function splitRoots(value: string | undefined, delimiter: string): string[] {
  return (value ?? "")
    .split(delimiter)
    .map((r) => r.trim())
    .filter(Boolean);
}

function parseFolders(value: string | undefined): WorkspaceFolderRef[] | undefined {
  if (value == null || value.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .filter((f) => f && typeof f.name === "string" && typeof f.path === "string")
      .map((f) => ({ name: f.name, path: f.path }));
  } catch {
    return undefined;
  }
}

function cleanFolders(folders: unknown): WorkspaceFolderRef[] | undefined {
  if (!Array.isArray(folders)) return undefined;
  const out = folders
    .filter((f) => f && typeof f.name === "string" && typeof f.path === "string")
    .map((f) => ({ name: f.name as string, path: f.path as string }));
  return out;
}

/**
 * Resolve the server's effective config from env + the optional machine-level
 * file, applying env-wins-over-file precedence. `pathDelimiter` is injected so
 * the function stays pure/testable (`path.delimiter` on the caller).
 */
export function resolveServerConfig(
  env: Env,
  file: ServerConfigFile | null | undefined,
  pathDelimiter = ":",
): ResolvedServerConfig {
  const f = file ?? {};

  const envRoots = splitRoots(env.THINKUBE_ROOTS, pathDelimiter);
  const fileRoots = Array.isArray(f.roots)
    ? f.roots.filter((r): r is string => typeof r === "string")
    : [];
  const roots = envRoots.length > 0 ? envRoots : fileRoots;

  const envFolders = parseFolders(env.THINKUBE_FOLDERS);
  const folders = envFolders ?? cleanFolders(f.folders) ?? [];

  const envThinkingSpaceRoot = (env.THINKUBE_THINKING_SPACE_ROOT ?? "").trim() || undefined;
  const thinkingSpaceRoot = envThinkingSpaceRoot ?? (typeof f.thinkingSpaceRoot === "string" && f.thinkingSpaceRoot.trim() ? f.thinkingSpaceRoot.trim() : undefined);

  const allowAIWrites =
    env.THINKUBE_ALLOW_AI_WRITES != null
      ? env.THINKUBE_ALLOW_AI_WRITES.toLowerCase() === "true"
      : typeof f.allowAIWrites === "boolean"
        ? f.allowAIWrites
        : true;

  // Fail closed (2026-07-14): blocking unless advisory is EXPLICITLY chosen.
  const docsGateMode: DocsGateMode =
    (env.THINKUBE_DOCS_GATE_MODE ?? "").toLowerCase() === "advisory"
      ? "advisory"
      : "blocking";

  const legacyWorkspace = (env.THINKUBE_WORKSPACE ?? "").trim() || undefined;

  // The certification auditor's model (2026-07-14): configurable, sonnet fallback.
  const auditorModel = (env.THINKUBE_AUDITOR_MODEL ?? "").trim() || "sonnet";

  return { roots, folders, thinkingSpaceRoot, allowAIWrites, docsGateMode, legacyWorkspace, auditorModel };
}
