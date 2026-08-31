/**
 * McpServer - MCP (Model Context Protocol) server configuration
 *
 * MCP servers extend Claude Code's capabilities by providing
 * access to external tools, databases, and services.
 *
 * Claude Code reads MCP config from .mcp.json (project root).
 * Two transport types are supported: stdio (command+args) and http (url).
 */

type McpServerStatus = "running" | "stopped" | "starting" | "error";
/**
 * Stdio server — runs a local process.
 */
interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * HTTP server — connects to a remote URL (streamable-HTTP or SSE).
 */
export interface HttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

/**
 * Union of both transport types.
 * Stdio configs have no `type` field; HTTP configs have `type: 'http'`.
 */
export type McpServerConfig = StdioServerConfig | HttpServerConfig;

export interface McpServer {
  id: string;
  name: string;
  config: McpServerConfig;
  status?: McpServerStatus;
  tools?: string[];
  errorMessage?: string;
}

/**
 * Type guard: is this an HTTP server config?
 */
export function isHttpServer(
  config: McpServerConfig,
): config is HttpServerConfig {
  return "type" in config && (config as HttpServerConfig).type === "http";
}
