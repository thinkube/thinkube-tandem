import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { loadTemplate } from "../promptTemplates";
// ── Judge guidance on the slice card (2026-07-12): the auditable rework channel ─────
//
// When the closing gate goes red and the judge routes the fault to one role, the judge's
// diagnosis (rationale + failing evidence) is APPENDED to the slice card as a round-stamped
// `## ⚖ Judge guidance` section addressed to that role — never overwritten, so the card
// carries the full history of what each rework round was told (the audit trail a human
// reads on the board). The re-dispatched worker's prompt renders the sections addressed to
// its role with an explicit PRIORITIZE instruction. This replaces the old
// `buildTestReworkContext` seam, which handed the diagnosis to the test-author only and
// left the code-author blind (the 2026-07-11 repair's principle applies to every fixer:
// grading independence lives in the judge, never in hiding the failure from the fixer).

/** Heading regex for one judge-guidance section; captures round + addressed role. */
const JUDGE_GUIDANCE_RE =
  /^##\s+⚖\s+Judge guidance — round (\d+) → (code|test)-author\s*$/;

/**
 * Append one round's judge guidance to a slice body as a durable, round-stamped section
 * addressed to the routed role. Append-only by design: prior rounds stay on the card
 * (auditability) — hygiene never collapses ⚖ sections the way it does ⚑ blocks. Pure.
 */
export function appendJudgeGuidance(
  body: string,
  round: number,
  route: "code" | "test",
  text: string,
): string {
  const section = `\n\n## ⚖ Judge guidance — round ${round} → ${route}-author\n\n${text.trim()}\n`;
  return (body ?? "").trimEnd() + section;
}

/**
 * Extract the judge-guidance sections addressed to `role` from a slice body, oldest first
 * (each prefixed with its round header line so the worker sees the progression), or
 * undefined when none exist. The re-dispatched worker prompt renders this with the
 * PRIORITIZE instruction. Pure.
 */
export function extractJudgeGuidance(
  body: string,
  role: "code" | "test",
): string | undefined {
  const lines = (body ?? "").split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] | undefined;
  let header: string | undefined;
  const flush = () => {
    if (header && current) sections.push(`${header}\n${current.join("\n").trim()}`);
    current = undefined;
    header = undefined;
  };
  for (const line of lines) {
    const m = JUDGE_GUIDANCE_RE.exec(line);
    if (m) {
      flush();
      if (m[2] === role) {
        header = `(round ${m[1]})`;
        current = [];
      }
      continue;
    }
    if (current !== undefined) {
      if (/^##\s+/.test(line)) {
        flush();
      } else {
        current.push(line);
      }
      continue;
    }
  }
  flush();
  return sections.length ? sections.join("\n\n") : undefined;
}

/**
 * Append one plan-repair record to a slice body (2026-07-12): a durable, round-stamped
 * `## 🛠 Plan repair` section carrying WHAT the repair changed (summary) and WHY the intent
 * justifies it. Append-only like the ⚖ sections — the card keeps the full amendment history,
 * and the delivery report's "Changes to the approved plan" renders the same records so the
 * human Accept decision sees every deviation from the initially approved plan. Pure.
 */
export function appendPlanRepair(
  body: string,
  round: number,
  summary: string,
  justification: string,
): string {
  return (
    (body ?? "").trimEnd() +
    `\n\n## 🛠 Plan repair — round ${round}\n\n` +
    `**What changed:** ${summary.trim()}\n\n` +
    `**Why the intent justifies it:** ${justification.trim()}\n`
  );
}

/**
 * The inner text of one `## <heading>` section of a markdown body (heading line excluded,
 * runs to the next `## ` or EOF), or "" when absent. The plan-repair lane reads the current
 * `## Acceptance Criteria` section with this before proposing an amendment. Pure.
 */
export function sectionText(body: string, heading: string): string {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s+${esc}\\s*$`);
  const lines = (body ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => re.test(l));
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

/**
 * The chat prefill priming an `/attend` session: the `/attend` skill invocation
 * for the requires-attention slice, the worktree the fix lands in, and the
 * failure VERBATIM (2026-07-11: the old anti-gaming scrubber blinded the fixer
 * to exactly the fault classes — broken probe, phantom footprint — it most
 * needed to see; grading independence lives in the assessor/judge, never in
 * hiding the failure from the fixer). The session itself opens in the CANONICAL
 * repo, which survives worktree retirement — hence the explicit worktree note.
 * A no-`divergence` call is just the bare `/attend <handle>` invocation. Pure.
 */
export function buildAttendPrompt(
  handle: string,
  divergence?: string,
  worktreePath?: string,
): string {
  return (
    `/attend ${handle}` +
    (worktreePath
      ? `\n\nThe Spec's worktree — apply the fix THERE and commit it to the spec branch before handing back: ${worktreePath}`
      : "") +
    (divergence ? `\n\n${divergence}` : "")
  );
}

/**
 * The chat prefill priming a Spec-level `/attend` session (SP-11/2 + SP-6 AC3) — the spec-level
 * analog of {@link buildAttendPrompt}, hosted here so the rework/divergence builders live in one
 * pure place (reuse, don't fork). It is the `/attend SP-<specId>` skill invocation, followed —
 * when the Spec lives on a cross-repo project thinking space — by the thinking-space note so every
 * kanban call addresses it explicitly, then the worktree the rework lands in,
 * then the divergence VERBATIM (2026-07-11 — see {@link buildAttendPrompt}).
 * No divergence ⇒ no trailing paragraph. Pure.
 */
export function buildRejectPrompt(
  specId: string,
  divergence?: string,
  projectThinkingSpaceId?: string,
  worktreePath?: string,
): string {
  // For a cross-repo project member the Spec lives on the project thinking space, NOT on this
  // worktree's repo thinking space — so every kanban call must address it explicitly.
  const thinkingSpaceNote = projectThinkingSpaceId
    ? `\n\nIMPORTANT — this Spec lives on the project thinking space \`${projectThinkingSpaceId}\`, not on this worktree's repo. Pass \`thinking_space=${projectThinkingSpaceId}\` to EVERY kanban tool (get_thinkube_file / get_slice / list_thinking_space / move_slice / patch_spec_section / write_spec / create_slice). Your cwd's thinking space is the working repo where the code lives, which is NOT this Spec's thinking space.`
    : "";
  const worktreeNote = worktreePath
    ? `\n\nThe Spec's worktree — apply the rework THERE and commit it to the spec branch: ${worktreePath}`
    : "";
  const divergenceNote = divergence ? `\n\n${divergence}` : "";
  return (
    `/attend SP-${specId}` + thinkingSpaceNote + worktreeNote + divergenceNote
  );
}

/**
 * Line-buffered NDJSON parser for a worker's persisted `.jsonl` session log. Feed raw stdout
 * chunks; returns the parsed objects for every **complete** line so far, holding a trailing
 * partial line until the next chunk. Blank and unparseable lines are skipped (never throws).
 */
export class StreamJsonBuffer {
  private buf = "";

  push(chunk: string): Record<string, unknown>[] {
    this.buf += chunk;
    const out: Record<string, unknown>[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const obj: unknown = JSON.parse(line);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          out.push(obj as Record<string, unknown>);
        }
      } catch {
        /* non-JSON line (e.g. a stray log) — skip */
      }
    }
    return out;
  }
}

/**
 * Summarize a stream-json event into a one-line session-log string, or null to skip.
 * Event shapes verified against claude v2.1.178: system/init, assistant (text + tool_use),
 * result.
 */
export const clip = (x: string, n: number): string =>
  x.length > n ? x.slice(0, n - 1) + "…" : x;

/** A readable one-liner for a tool_use — name PLUS the part that matters (the command, file,
 *  pattern, query), so the log is debuggable instead of a column of bare `▸ Bash`. */
export function toolUseSummary(name: string, input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (name) {
    case "Bash":
      return `▸ $ ${clip(str(inp.command).replace(/\s+/g, " "), 160)}`;
    case "Read":
      return `▸ Read ${str(inp.file_path)}`;
    case "Write":
      return `▸ Write ${str(inp.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `▸ Edit ${str(inp.file_path)}`;
    case "Glob":
      return `▸ Glob ${str(inp.pattern)}`;
    case "Grep":
      return `▸ Grep ${str(inp.pattern)}${inp.path ? ` in ${str(inp.path)}` : ""}`;
    case "ToolSearch":
      return `▸ ToolSearch ${clip(str(inp.query), 80)}`;
    default: {
      let j = "";
      try {
        j = JSON.stringify(inp);
      } catch {
        /* unserializable */
      }
      return `▸ ${name}${j && j !== "{}" ? ` ${clip(j, 120)}` : ""}`;
    }
  }
}

/** The first non-empty line of a tool_result, indented under its call (✗ when it errored). */
export function toolResultSummary(
  block: Record<string, unknown>,
): string | null {
  let text = "";
  if (typeof block.content === "string") text = block.content;
  else if (Array.isArray(block.content))
    text = (block.content as Array<Record<string, unknown>>)
      .filter((x) => x.type === "text" && typeof x.text === "string")
      .map((x) => x.text as string)
      .join(" ");
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return null;
  return `   ${block.is_error === true ? "✗" : "⤷"} ${clip(first, 160)}`;
}

/**
 * Summarize a session-log event into one or more lines (newline-joined), or null to skip.
 * Renders assistant text + tool_use (with its input), tool_result snippets, and the final result.
 */
export function summarizeEvent(evt: Record<string, unknown>): string | null {
  if (evt.type === "system" && evt.subtype === "init")
    return "▸ session started";
  if (evt.type === "assistant") {
    const msg = evt.message as { content?: unknown } | undefined;
    const content = Array.isArray(msg?.content) ? msg!.content : [];
    const parts: string[] = [];
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim())
        parts.push(b.text.trim());
      if (b.type === "tool_use" && typeof b.name === "string")
        parts.push(toolUseSummary(b.name, b.input));
    }
    return parts.length ? parts.join("\n") : null;
  }
  if (evt.type === "user") {
    const msg = evt.message as { content?: unknown } | undefined;
    const content = Array.isArray(msg?.content) ? msg!.content : [];
    const parts: string[] = [];
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type === "tool_result") {
        const s = toolResultSummary(b);
        if (s) parts.push(s);
      }
    }
    return parts.length ? parts.join("\n") : null;
  }
  if (evt.type === "result") {
    return isResultSuccess(evt)
      ? "✓ result: success"
      : `✗ result: ${String(evt.subtype ?? "error")}`;
  }
  return null;
}

/** Did a parsed stream-json `result` event report success? */
export function isResultSuccess(evt: Record<string, unknown>): boolean {
  return (
    evt.type === "result" && evt.is_error !== true && evt.subtype === "success"
  );
}

