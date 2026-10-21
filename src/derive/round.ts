/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one SDK round runner. Rounds are read-only over a repository and
 * return their final text; anything that mutates goes through workers with
 * work orders, never through a round. Fail-soft: null on any failure, so a
 * broken round never blocks the space.
 */
import { theModel } from "../engine/theModel";
import { z } from "zod";

export interface RoundDeps {
  model: string;
  /** Cheaper model for volume work (classification, naming, text-only
   *  analysis). Judgment stays on `model`; absent → `model` everywhere. */
  volumeModel?: string;
  repoRoot: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  /** "none": a single completion, no tools — for rounds whose entire input
   *  is already in the prompt. Default: read-only repo tools. */
  tools?: "read" | "none";
  log?: (line: string) => void;
  /** Cancels the round mid-flight (the human pressed Cancel). */
  abort?: AbortController;
  /** Opens a listener on this round's stream. Given one, the round streams
   *  partial messages, so a model that thinks for minutes without calling a
   *  tool is still heard moving. */
  pulse?: () => RoundPulse;
  /** The shape of the answer, as a JSON schema (`jsonSchemaOf`). Given one,
   *  the harness holds the model to it and retries a malformed answer
   *  itself; the round's text is then the answer and nothing else. */
  schema?: Record<string, unknown>;
}

/**
 * A round's answer shape as the harness takes it: the JSON schema of a zod
 * shape, without the dialect marker the API does not want.
 */
export function jsonSchemaOf(shape: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(shape) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

/**
 * A round's answer, read against its shape. The harness validated it
 * before it came back, so this is the typed reading; a round that failed,
 * or a fake that answers prose, reads as nothing.
 */
export function readAnswer<T>(shape: z.ZodType<T>, raw: string | null): T | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const read = shape.safeParse(parsed);
  return read.success ? read.data : undefined;
}

/** What a listener hears of one running round: every event its stream
 *  yields, and its end. */
export interface RoundPulse {
  heard: () => void;
  ended: () => void;
}

/** The volume variant of a round's deps: cheap model, one turn, no tools,
 *  medium effort — for text-in/JSON-out work where agency buys nothing. */
export function volumeDeps(deps: RoundDeps): RoundDeps {
  return {
    ...deps,
    model: deps.volumeModel ?? deps.model,
    tools: "none",
    effort: "medium",
  };
}

/**
 * A round with no tools cannot loop on anything, so its turn allowance is
 * a guard against nothing. One turn is not enough: a round that spends a
 * turn thinking before it answers hits the cap and the SDK raises, which
 * killed a reading that had already been written.
 */
const TOOLLESS_TURNS = 4;

type SdkQuery = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export async function runReadRound(
  deps: RoundDeps,
  prompt: string,
): Promise<string | null> {
  let query: SdkQuery;
  try {
    const mod = (await theModel("round")) as {
      query: SdkQuery;
    };
    query = mod.query;
  } catch (err) {
    deps.log?.(
      `round cannot run — Agent SDK failed to load: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  return collectText(
    () =>
      query({
        prompt,
        options: {
          model: deps.model,
          ...(deps.abort ? { abortController: deps.abort } : {}),
          permissionMode: "bypassPermissions",
          // Nothing of the person's: no settings, hooks, instruction files
          // or MCP servers. Each round would otherwise start every MCP
          // server the person has and carry its tool list, for a call
          // that reads code or turns text into JSON.
          settingSources: [],
          strictMcpConfig: true,
          thinking: { type: "adaptive" },
          effort: deps.effort ?? "high",
          maxTurns: deps.maxTurns ?? (deps.tools === "none" ? TOOLLESS_TURNS : 40),
          // The built-in tools that exist for this round, as an allow list:
          // a tool a later release adds is closed by default.
          tools: deps.tools === "none" ? [] : ["Read", "Grep", "Glob"],
          allowedTools: deps.tools === "none" ? [] : ["Read", "Grep", "Glob"],
          ...(deps.schema ? { outputFormat: { type: "json_schema", schema: deps.schema } } : {}),
          disallowedTools: [
            "Write",
            "Edit",
            "NotebookEdit",
            "Bash",
            "WebFetch",
            "WebSearch",
            "Task",
            "AskUserQuestion",
            "ExitPlanMode",
          ],
          additionalDirectories: [deps.repoRoot],
          ...(deps.pulse ? { includePartialMessages: true } : {}),
        },
      }),
    deps.log,
    deps.pulse,
  );
}

/**
 * Read a round's stream into its text. A round that fails AFTER writing
 * its answer keeps that answer: the reply arrived, and throwing it away
 * turns a recoverable round into a failure the human has to repeat.
 */
/** One line for what a round just reached for, and at what. */
function describeUse(b: Record<string, unknown>): string {
  const name = typeof b.name === "string" ? b.name : "tool";
  const input = (b.input ?? {}) as Record<string, unknown>;
  const of =
    ["file_path", "path", "pattern", "glob", "command"]
      .map((k) => (typeof input[k] === "string" ? (input[k] as string) : ""))
      .find(Boolean) ?? "";
  return of ? `${name} ${of.length > 100 ? `${of.slice(0, 100)}…` : of}` : name;
}

export async function collectText(
  stream: () => AsyncIterable<unknown>,
  log?: (line: string) => void,
  pulse?: () => RoundPulse,
): Promise<string | null> {
  const listening = pulse?.();
  let text = "";
  // What a round SPENDS, as it spends it: a round that takes minutes and
  // reports nothing cannot be made faster by anyone — every lever (fewer
  // turns, a cheaper model, no search tools) is a guess until the turns
  // say where they went.
  const began = Date.now();
  let turns = 0;
  const at = (): string => `${((Date.now() - began) / 1000).toFixed(0)}s`;
  try {
    for await (const msg of stream()) {
      listening?.heard();
      const rec = msg as Record<string, unknown>;
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        for (const b of (Array.isArray(m?.content) ? m!.content : []) as Array<
          Record<string, unknown>
        >) {
          if (b.type === "text" && typeof b.text === "string") text += b.text;
          if (b.type === "tool_use") {
            turns++;
            log?.(`  ${at()} ⚙ ${describeUse(b)}`);
          }
        }
      } else if (rec.type === "result") {
        // A round held to a shape answers with the shape; the text is then
        // that answer and nothing else. Any other round answers in words.
        if (rec.structured_output !== undefined) text = JSON.stringify(rec.structured_output);
        else if (typeof rec.result === "string") text = rec.result;
        log?.(`  ${at()} ✓ round done — ${turns} tool use(s)`);
      }
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (text.trim()) {
      log?.(`round ended early (${why}) — keeping the ${text.length} characters it wrote`);
      return text;
    }
    log?.(`round errored: ${why}`);
    return null;
  } finally {
    listening?.ended();
  }
  return text;
}
