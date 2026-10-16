/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

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
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as path from "node:path";
import { attach } from "./attach";
import type { Attached } from "./attach";
import { confirmation, confirmed, machineMay } from "./boundary";
import { PROMPTS } from "./prompts";
import { labelOf } from "../surfaces/actions";
import { toolTable } from "./tools";
import { appendWorkingOut } from "../run/runLog";
import type { ToolCall } from "./tools";

/** One line of what the server is bound to, on stderr — stdout is the
 *  protocol and anything written there corrupts it. */
function say(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** A line of work done in a space: said, and kept in the space's
 *  working-out log beside its run logs, so work this server started is
 *  readable by someone who is not reading its stderr. */
function sayIn(storeDir: string, line: string): void {
  say(line);
  try {
    appendWorkingOut(storeDir, line);
  } catch (e) {
    say(`the working-out log in ${storeDir} cannot be written: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * The person's yes to one of their own acts, asked through the client.
 *
 * A client that cannot ask (no elicitation capability) gets the refusal
 * as before. One that can shows the person what is about to happen; a
 * decline, a cancel or a failure to ask is a no, said in words.
 */
async function askThePerson(
  server: Server,
  tool: { name: string; action: string },
  args: Record<string, unknown>,
  refusal: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!server.getClientCapabilities()?.elicitation) return { ok: false, reason: refusal };
  try {
    const answer = await server.elicitInput(confirmation(tool.action, tool.name, args));
    if (confirmed(answer)) {
      say(`${labelOf(tool.action)}: the person said yes to ${tool.name}`);
      return { ok: true };
    }
    return { ok: false, reason: `${labelOf(tool.action)} — you were asked and did not say yes, so nothing was done.` };
  } catch (e) {
    return { ok: false, reason: `${refusal}; asking you failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // A space is named per call, never pinned at launch: one server serves
  // every space the store knows, so switching spaces is an argument rather
  // than a re-registration and a restart.
  const defaultRepo = get("repo") ?? process.env.TANDEM_REPO;
  const sessions = new Map<string, Attached & { ok: true }>();
  const bind = async (repo: string, space: string): Promise<Attached> => {
    const key = `${path.resolve(repo)}::${space}`;
    const held = sessions.get(key);
    if (held) {
      // A run lives in its own process and files its delivery there; the
      // store is the only word of it that reaches a held session.
      held.session.reloadFromStore();
      return held;
    }
    const r = await attach({ repo, space, onChanged: (m, storeDir) => m && sayIn(storeDir, `· ${m}`) });
    if (r.ok) {
      sessions.set(key, r);
      sayIn(r.storeDir, `attached to ${r.project.card.label} / ${space} as ${r.session.author}`);
    }
    return r;
  };

  const table = toolTable();
  const server = new Server(
    { name: "thinkube-tandem", version: "1.0.0" },
    { capabilities: { tools: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: table.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: PROMPTS.map((p) => ({ name: p.name, description: p.description, arguments: p.arguments })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, (req) => {
    const p = PROMPTS.find((x) => x.name === req.params.name);
    if (!p) throw new Error(`no such prompt: ${req.params.name}`);
    const args = Object.fromEntries(
      Object.entries(req.params.arguments ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : String(v)]),
    );
    const missing = p.arguments.filter((a) => a.required && !args[a.name]).map((a) => a.name);
    if (missing.length) throw new Error(`${p.name} needs ${missing.join(", ")}`);
    return {
      description: p.description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: p.text(args) } }],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = table.find((t) => t.name === req.params.name);
    if (!tool)
      return {
        isError: true,
        content: [{ type: "text" as const, text: `no such tool: ${req.params.name}` }],
      };
    const args = (req.params.arguments ?? {}) as ToolCall["args"];
    // The boundary, before any space is opened at all. A person's act is
    // refused to a machine — unless the client can ask the person, in
    // which case the call waits for their yes.
    const may = machineMay(tool.action);
    if (!may.ok) {
      const asked = await askThePerson(server, tool, args, may.reason);
      if (!asked.ok) return { isError: true, content: [{ type: "text" as const, text: asked.reason }] };
    }
    try {
      if (tool.spaceless) return { content: [{ type: "text" as const, text: await tool.run({ args } as ToolCall) }] };
      const space = typeof args.space === "string" ? args.space : "";
      const repo = typeof args.repo === "string" ? args.repo : defaultRepo;
      if (!space || !repo)
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "name the space (and the project directory, unless the server was started with --repo). list_spaces shows both.",
            },
          ],
        };
      const bound = await bind(repo, space);
      if (!bound.ok)
        return { isError: true, content: [{ type: "text" as const, text: bound.reason }] };
      const text = await tool.run({
        session: bound.session,
        project: bound.project,
        storeDir: bound.storeDir,
        args,
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
