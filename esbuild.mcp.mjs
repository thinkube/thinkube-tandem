/**
 * Bundles the kanban MCP server into a single self-contained file
 * (`dist/mcp/kanban.js`) for shipping inside the tandem-methodology plugin
 * (TEP-tgvwct, Phase 3). No dependence on the extension's node_modules or the
 * globalStorage symlink — `node ${CLAUDE_PLUGIN_ROOT}/mcp/kanban.js` just runs.
 *
 * - `vscode` is aliased to the in-repo stub (the only real consumer is
 *   ThinkubeStore's load-time EventEmitter), so no `vscode` package is needed.
 * - `node-pty` / `@octokit/rest` are out of the server's runtime graph; marked
 *   external so esbuild never tries to bundle native/heavy extension-only deps.
 * - The MCP SDK is dynamic-imported; esbuild inlines it into the CJS output.
 */
import * as esbuild from "esbuild";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(root, "src/mcp/kanbanMcpServer.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(root, "dist/mcp/kanban.js"),
  alias: { vscode: path.join(root, "src/mcp/vscodeStub.ts") },
  external: ["node-pty", "@octokit/rest", "@anthropic-ai/claude-agent-sdk"],
  logLevel: "info",
});

console.log("bundled dist/mcp/kanban.js");
