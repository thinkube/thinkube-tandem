/**
 * Unit tests for applyKanbanRegistration (TEP-th3i18 follow-up). Pure — no fs/vscode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyKanbanRegistration,
  KANBAN_SERVER_ID,
} from "./kanbanRegistration";

const ENTRY = {
  command: "node",
  args: ["/gs/extension-current/dist/mcp/kanbanMcpServer.js"],
  env: { THINKUBE_SIGNING_KEY_DIR: "/gs/signing" },
};

test("adds the kanban server to an empty/absent settings object", () => {
  for (const input of [null, undefined, {}]) {
    const { settings, changed } = applyKanbanRegistration(input, ENTRY);
    assert.equal(changed, true);
    const servers = settings.mcpServers as Record<string, unknown>;
    assert.deepEqual(servers[KANBAN_SERVER_ID], ENTRY);
  }
});

test("preserves other top-level keys and other mcp servers", () => {
  const input = {
    permissions: { allow: ["X"] },
    theme: "dark",
    mcpServers: { playwright: { command: "playwright-mcp" } },
  };
  const { settings } = applyKanbanRegistration(input, ENTRY);
  assert.deepEqual(settings.permissions, { allow: ["X"] });
  assert.equal(settings.theme, "dark");
  const servers = settings.mcpServers as Record<string, unknown>;
  assert.deepEqual(servers.playwright, { command: "playwright-mcp" });
  assert.deepEqual(servers[KANBAN_SERVER_ID], ENTRY);
});

test("is idempotent — no change when the entry already matches", () => {
  const input = { mcpServers: { [KANBAN_SERVER_ID]: { ...ENTRY } } };
  const { changed } = applyKanbanRegistration(input, ENTRY);
  assert.equal(changed, false);
});

test("rewrites when the existing entry differs (e.g. an extension-version path bump)", () => {
  const stale = {
    mcpServers: {
      [KANBAN_SERVER_ID]: {
        command: "node",
        args: ["/old/path/kanbanMcpServer.js"],
        env: {},
      },
    },
  };
  const { settings, changed } = applyKanbanRegistration(stale, ENTRY);
  assert.equal(changed, true);
  const servers = settings.mcpServers as Record<string, unknown>;
  assert.deepEqual(servers[KANBAN_SERVER_ID], ENTRY);
});
