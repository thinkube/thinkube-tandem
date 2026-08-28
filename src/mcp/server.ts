/**
 * Tandem as a server: a thinking space driven from outside the editor.
 *
 * Every tool passes through the machine boundary (./boundary) before it
 * touches the session, so what a server may do is decided in one declared
 * place rather than by which tools somebody remembered to leave out. The
 * two gates are not here and cannot be added by accident: an undeclared
 * action is refused.
 *
 * The session is the editor's own — same store directory, same author,
 * same approval storage — so a space driven here is the space the person
 * is watching, and the editor follows it live (see hostui/storeWatch).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { attach } from "./attach";
import { machineMay } from "./boundary";
import { toolTable } from "./tools";
import type { ToolCall } from "./tools";

/** One line of what the server is bound to, on stderr — stdout is the
 *  protocol and anything written there corrupts it. */
function say(line: string): void {
  process.stderr.write(`${line}\n`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = get("repo") ?? process.env.TANDEM_REPO;
  const space = get("space") ?? process.env.TANDEM_SPACE;
  if (!repo || !space) {
    say("usage: --repo <enabled project dir> --space <thinking space name>");
    return 2;
  }
  const bound = await attach({ repo, space, onChanged: (m) => m && say(`· ${m}`) });
  if (!bound.ok) {
    say(`cannot attach: ${bound.reason}`);
    return 1;
  }
  say(`attached to ${bound.project.card.label} / ${space} as ${bound.session.author}`);

  const table = toolTable();
  const server = new Server(
    { name: "thinkube-tandem", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: table.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = table.find((t) => t.name === req.params.name);
    if (!tool)
      return {
        isError: true,
        content: [{ type: "text" as const, text: `no such tool: ${req.params.name}` }],
      };
    // The boundary, before the session is touched at all.
    const may = machineMay(tool.action);
    if (!may.ok)
      return { isError: true, content: [{ type: "text" as const, text: may.reason }] };
    try {
      const text = await tool.run({
        session: bound.session,
        project: bound.project,
        storeDir: bound.storeDir,
        args: (req.params.arguments ?? {}) as ToolCall["args"],
      });
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
      };
    }
  });

  await server.connect(new StdioServerTransport());
  say("listening on stdio");
  return 0;
}

if (require.main === module)
  void main(process.argv.slice(2)).then(
    (code) => {
      if (code !== 0) process.exit(code);
    },
    (e: unknown) => {
      say(`${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
