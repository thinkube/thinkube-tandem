/**
 * Pure helpers for the user-scope kanban MCP-server registration (
 * follow-up). No fs/vscode — so the merge logic is unit-tested. The vscode/fs glue
 * (building the entry from workspace config, reading/writing `settings.json`) lives
 * in `machineConfig.ts`.
 */

/** Server id under `mcpServers` — matches the name each repo's `.mcp.json` uses. */
export const KANBAN_SERVER_ID = "thinkube-kanban";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural equality over JSON-ish values (key-order independent) — for the
 *  idempotency check so we don't rewrite settings.json on every activation. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => jsonEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Merge the kanban server entry into a parsed Claude `settings.json` under
 * `mcpServers.thinkube-kanban`: non-clobbering (every other key and every other
 * server is preserved) and idempotent (`changed` is false when the entry already
 * matches). Pure.
 */
export function applyKanbanRegistration(
  input: Record<string, unknown> | null | undefined,
  entry: Record<string, unknown>,
): { settings: Record<string, unknown>; changed: boolean } {
  const before: Record<string, unknown> = isPlainObject(input) ? input : {};
  const servers = isPlainObject(before.mcpServers)
    ? { ...before.mcpServers }
    : {};
  if (jsonEqual(servers[KANBAN_SERVER_ID], entry)) {
    return { settings: before, changed: false };
  }
  servers[KANBAN_SERVER_ID] = entry;
  return { settings: { ...before, mcpServers: servers }, changed: true };
}
