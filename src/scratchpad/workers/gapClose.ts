/**
 * The gap-close round (self-drive fork b, 2026-07-18).
 *
 * The engine drives uncertainty down without a manual "now close the gaps"
 * trigger. For every OPEN gap it reads the product's declared sources and
 * decides:
 *
 *  - RESEARCHABLE — the answer is a fact findable in the sources. It closes
 *    the gap (closeGap: resolve + evidence). Risk falls mechanically.
 *  - DECISION — no fact to find (a design choice). It gathers the options and
 *    RECOMMENDS one (proposeDecision), leaving the gap open and flagged for
 *    the human to ratify with one gesture. Design authority stays human.
 *
 * A single read-tool SDK round over all open gaps; output validated to
 * closeGap / proposeDecision actions targeting real open gaps.
 */

import type { Action, WorkingModel } from "../model";

/** Open gap items (active), id + text. */
export function openGaps(model: WorkingModel): { id: string; text: string }[] {
  return model.sections
    .filter((s) => s.kind === "gap")
    .flatMap((s) => s.items)
    .filter((it) => it.state === "active" && !it.decisionProposal)
    .map((it) => ({ id: it.id, text: it.text }));
}

/** Build the gap-close prompt. Pure; exported for tests. */
export function buildGapClosePrompt(
  model: WorkingModel,
  sources: string[],
  contextDigest?: string,
): string {
  const gaps = openGaps(model);
  const gapBlock = gaps.map((g) => `  - ${g.id}: ${g.text}`).join("\n");
  return (
    `You are the GAP-CLOSE round. Drive the space's uncertainty down: for each OPEN gap below, ` +
    `read the declared sources and decide whether it is RESEARCHABLE or a DECISION.\n\n` +
    `DECLARED SOURCES (read-only — cite what you use):\n${sources.map((s) => `- ${s}`).join("\n")}\n\n` +
    (contextDigest?.trim()
      ? `CONTEXT DIGEST (already gathered — build on it):\n${contextDigest.slice(0, 3000)}\n\n`
      : "") +
    `OPEN GAPS:\n${gapBlock}\n\n` +
    `For EACH gap, emit EXACTLY ONE action:\n` +
    `- RESEARCHABLE (the answer is a FACT in the sources): find it, then emit\n` +
    `  {"type":"closeGap","itemId":"<gap id>","evidence":{"source":"<file/path you read>","method":"read","summary":"<the answer, one sentence>"}}\n` +
    `- DECISION (a design choice with no factual answer — e.g. which library, which UX mode): ` +
    `research the realistic options, then emit\n` +
    `  {"type":"proposeDecision","itemId":"<gap id>","recommendation":"<the option you recommend>","reasoning":"<why, and the alternatives considered>"}\n\n` +
    `Rules:\n` +
    `- NEVER guess a researchable answer — if you cannot find the fact, treat it as a DECISION and recommend.\n` +
    `- NEVER invent gap ids — use exactly the ids above.\n` +
    `- Respond with ONE JSON object: {"actions":[ ... ]}. No prose outside it.`
  );
}

/**
 * Run the gap-close round: read tools over the sources, parse the model's
 * closeGap / proposeDecision actions, validate against open gaps. Returns
 * the validated actions (empty on failure — fail-soft).
 */
export async function runGapClose(
  deps: {
    model: string;
    sources: string[];
    contextDigest?: string;
    now: () => Date;
  },
  workingModel: WorkingModel,
): Promise<Action[]> {
  const gaps = new Map(openGaps(workingModel).map((g) => [g.id, g.text]));
  if (gaps.size === 0) return [];

  let sdkQuery: (args: {
    prompt: string;
    options: Record<string, unknown>;
  }) => AsyncIterable<unknown>;
  try {
    const mod = (await import("@anthropic-ai/claude-agent-sdk")) as {
      query: typeof sdkQuery;
    };
    sdkQuery = mod.query;
  } catch {
    return [];
  }

  const prompt = buildGapClosePrompt(
    workingModel,
    deps.sources,
    deps.contextDigest,
  );
  let text = "";
  try {
    for await (const msg of sdkQuery({
      prompt,
      options: {
        model: deps.model,
        permissionMode: "bypassPermissions",
        thinking: { type: "disabled" },
        allowedTools: ["Read", "Grep", "Glob"],
        disallowedTools: [
          "Write",
          "Edit",
          "NotebookEdit",
          "Bash",
          "WebFetch",
          "WebSearch",
          "Task",
        ],
        additionalDirectories: deps.sources,
      },
    })) {
      const rec = msg as Record<string, unknown>;
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        const content = Array.isArray(m?.content) ? m!.content : [];
        for (const b of content as Array<Record<string, unknown>>)
          if (b.type === "text" && typeof b.text === "string") text += b.text;
      } else if (rec.type === "result" && typeof rec.result === "string") {
        text = rec.result;
      }
    }
  } catch {
    return [];
  }

  return parseGapCloseActions(text, gaps, deps.now().toISOString());
}

/** Parse + validate the round's JSON into closeGap/proposeDecision actions. */
export function parseGapCloseActions(
  raw: string,
  openGapIds: Map<string, string>,
  nowIso: string,
): Action[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: { actions?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as { actions?: unknown };
  } catch {
    return [];
  }
  const list = Array.isArray(parsed.actions) ? parsed.actions : [];
  const out: Action[] = [];
  const handled = new Set<string>();
  for (const a of list) {
    if (typeof a !== "object" || a === null) continue;
    const rec = a as Record<string, unknown>;
    const itemId = typeof rec.itemId === "string" ? rec.itemId : "";
    if (!openGapIds.has(itemId) || handled.has(itemId)) continue;
    if (rec.type === "closeGap") {
      const ev = (rec.evidence ?? {}) as Record<string, unknown>;
      const source = typeof ev.source === "string" ? ev.source : "";
      if (!source) continue;
      // The answer summary rides in `method` so it survives on the evidence
      // chip (Evidence has no free-text field of its own).
      const method =
        typeof ev.method === "string" ? ev.method : "read";
      const summary =
        typeof ev.summary === "string" && ev.summary.trim()
          ? ` — ${ev.summary.trim()}`
          : "";
      out.push({
        type: "closeGap",
        actor: "research",
        itemId,
        evidence: {
          source,
          method: `${method}${summary}`,
          checkedAt: nowIso,
        },
      });
      handled.add(itemId);
    } else if (rec.type === "proposeDecision") {
      const recommendation =
        typeof rec.recommendation === "string" ? rec.recommendation : "";
      if (!recommendation.trim()) continue;
      out.push({
        type: "proposeDecision",
        actor: "research",
        itemId,
        recommendation,
        reasoning: typeof rec.reasoning === "string" ? rec.reasoning : "",
      });
      handled.add(itemId);
    }
  }
  return out;
}
