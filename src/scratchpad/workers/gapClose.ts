/**
 * The gap-close JUDGE round.
 *
 * A judgment path, run on the stronger judge model with adaptive thinking —
 * mirroring the orchestrator's "judgment on Opus, volume on Sonnet" split. It
 * does NOT roam the repository; it judges each OPEN gap grounded in the context
 * digest already gathered (the sanctioned context channel) plus the space's
 * intent. For every gap it lands in exactly one of:
 *
 *  - RESEARCHABLE — the answer is a fact present in the digest. It closes the
 *    gap (closeGap: resolve + evidence). Risk falls mechanically.
 *  - DECIDABLE — an implementation choice that follows from intent + what
 *    exists. It DECIDES, writing the choice as a binding CONSTRAINT (with
 *    rationale + evidence) and resolving the gap. The human reviews/overrides
 *    the constraint later; nothing blocks on it.
 *  - INTENT FORK — a genuine preference/scope decision only the human can make.
 *    It RECOMMENDS (proposeDecision), leaving the gap open for the human's
 *    ratification. Design authority over intent stays human.
 *
 * A single SDK round, no read tools (blind judgment on the handed digest), so
 * adaptive thinking cannot run away on an unbounded read loop.
 */

import type { Action, Evidence, WorkingModel } from "../model";
import { thinkyDiag } from "../chat/diag";
import { summarizeEvent } from "./streamLog";

/** An open gap: id, text, and the element ids it serves (its requires edges),
 *  so a DECIDABLE gap's new constraint inherits the same element attachment
 *  and is never orphaned. */
export interface OpenGap {
  id: string;
  text: string;
  requires: string[];
  /** The ask this gap belongs to — inherited by a decided constraint so it
   *  stays ask-anchored (never orphaned). */
  servesEntries?: number[];
}

/** Open gap items (active, no decision proposal pending). */
export function openGaps(model: WorkingModel): OpenGap[] {
  return model.sections
    .filter((s) => s.kind === "gap")
    .flatMap((s) => s.items)
    .filter((it) => it.state === "active" && !it.decisionProposal)
    .map((it) => ({
      id: it.id,
      text: it.text,
      requires: [...(it.requires ?? [])],
      servesEntries: it.servesEntries ?? (it.servesEntry !== undefined ? [it.servesEntry] : undefined),
    }));
}

/** The constraints section id (for a DECIDABLE gap's new constraint). */
function constraintsSectionId(model: WorkingModel): string {
  return model.sections.find((s) => s.kind === "constraints")?.id ?? "";
}

/** Build the gap-close judge prompt. Pure; exported for tests. */
export function buildGapClosePrompt(
  model: WorkingModel,
  contextDigest?: string,
): string {
  const gaps = openGaps(model);
  const gapBlock = gaps.map((g) => `  - ${g.id}: ${g.text}`).join("\n");
  const goalText =
    model.sections.find((s) => s.kind === "goal")?.text.trim() ?? "";
  const assumptions = (model.assumptions ?? [])
    .map((a, i) => `${i + 1}. ${a.text}`)
    .join("\n");
  const digest = (contextDigest ?? "").trim();
  return (
    `You are the GAP-CLOSE JUDGE. For each OPEN gap below, judge it — grounded ONLY in the ` +
    `CONTEXT DIGEST and the space's intent, NOT from outside knowledge — into EXACTLY ONE of three kinds.\n\n` +
    `INTENT (what the space is for):\n${goalText || "(none)"}\n\n` +
    (assumptions
      ? `STANDING ASSUMPTIONS (must hold):\n${assumptions}\n\n`
      : "") +
    (digest
      ? `CONTEXT DIGEST (what already EXISTS — your evidence base; cite the part you used):\n${digest.slice(0, 12000)}\n\n`
      : `CONTEXT DIGEST: (none gathered — decide only what the intent alone settles; otherwise treat as an INTENT FORK.)\n\n`) +
    `OPEN GAPS:\n${gapBlock}\n\n` +
    `For EACH gap, emit EXACTLY ONE action:\n` +
    `- RESEARCHABLE — the answer is a FACT already present in the digest. Emit\n` +
    `  {"type":"closeGap","itemId":"<gap id>","evidence":{"source":"<the digest fact/path you used>","summary":"<the answer, one sentence>"}}\n` +
    `- DECIDABLE — an implementation choice that FOLLOWS from the intent + what exists (which mechanism, ` +
    `which model, which layout, which policy). DECIDE it yourself; it becomes a binding constraint. Emit\n` +
    `  {"type":"decide","itemId":"<gap id>","constraint":"<the boundary that now holds, as an invariant>","rationale":"<why this follows from intent + digest>","evidence":{"source":"<digest basis>","summary":"<one sentence>"}}\n` +
    `- INTENT FORK — a genuine preference or scope decision only the human can make (what to build, a trade-off ` +
    `the human owns). Emit\n` +
    `  {"type":"proposeDecision","itemId":"<gap id>","recommendation":"<the option you'd pick>","reasoning":"<why, and the alternatives>"}\n\n` +
    `Rules:\n` +
    `- Prefer DECIDABLE over INTENT FORK: only escalate what genuinely requires the human's intent. ` +
    `A choice with a best answer given the intent + digest is DECIDABLE, not a fork.\n` +
    `- NEVER invent a researchable answer — if the fact is not in the digest, it is DECIDABLE or an INTENT FORK, not RESEARCHABLE.\n` +
    `- NEVER invent gap ids — use exactly the ids above.\n` +
    `- Respond with ONE JSON object: {"actions":[ ... ]}. No prose outside it.`
  );
}

/**
 * Run the gap-close judge round: a single SDK round on the judge model with
 * adaptive thinking and NO read tools (it judges the handed digest), parse the
 * closeGap / decide / proposeDecision output, validate against open gaps.
 * Returns the validated actions (empty on failure — fail-soft).
 */
export async function runGapClose(
  deps: {
    /** The JUDGE model (e.g. "opus"). */
    model: string;
    /** Declared sources — kept for provenance/logging; NOT roamed. */
    sources: string[];
    /** The context digest — the evidence base, injected into the prompt. */
    contextDigest?: string;
    now: () => Date;
    /** Reasoning effort for the judge (default "high"). */
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    /** Optional USD ceiling. Unset by default: runs ride the Claude Code
     *  subscription, and a low cap aborts a legitimate round mid-judgment. */
    maxBudgetUsd?: number;
    /** Optional live-stream sink for the "Thinkube Scratchpad" output. */
    log?: (line: string) => void;
  },
  workingModel: WorkingModel,
): Promise<Action[]> {
  const gaps = new Map(openGaps(workingModel).map((g) => [g.id, g]));
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

  const prompt = buildGapClosePrompt(workingModel, deps.contextDigest);
  const secId = constraintsSectionId(workingModel);
  let text = "";
  deps.log?.(
    `▸ gap-close judge: ${gaps.size} gap(s) (model: ${deps.model}, thinking: adaptive, effort: ${deps.effort ?? "high"})`,
  );
  try {
    for await (const msg of sdkQuery({
      prompt,
      options: {
        model: deps.model,
        permissionMode: "bypassPermissions",
        // A JUDGMENT path — adaptive thinking on, effort as the depth dial.
        // Safe because there are no read tools: it judges the handed digest,
        // so thinking cannot run away on an unbounded read loop.
        thinking: { type: "adaptive" },
        effort: deps.effort ?? "high",
        ...(deps.maxBudgetUsd !== undefined
          ? { maxBudgetUsd: deps.maxBudgetUsd }
          : {}),
        disallowedTools: [
          "Read",
          "Grep",
          "Glob",
          "Bash",
          "WebFetch",
          "WebSearch",
          "Write",
          "Edit",
          "NotebookEdit",
          "Task",
        ],
      },
    })) {
      const rec = msg as Record<string, unknown>;
      const rendered = summarizeEvent(rec);
      if (rendered)
        for (const l of rendered.split("\n")) if (l.trim()) deps.log?.(`  ${l}`);
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        const content = Array.isArray(m?.content) ? m!.content : [];
        for (const b of content as Array<Record<string, unknown>>)
          if (b.type === "text" && typeof b.text === "string") text += b.text;
      } else if (rec.type === "result" && typeof rec.result === "string") {
        text = rec.result;
      }
    }
  } catch (err) {
    thinkyDiag(
      `gap-close SDK error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
  const actions = parseGapCloseActions(
    text,
    gaps,
    secId,
    deps.now().toISOString(),
  );
  thinkyDiag(
    `gap-close: raw=${text.length} chars, parsed=${actions.length} action(s) [${actions.map((a) => a.type).join(",")}]`,
  );
  return actions;
}

/** Parse + validate the round's JSON into closeGap / proposeDecision /
 *  (decide → proposeItem-constraint + closeGap) actions. */
export function parseGapCloseActions(
  raw: string,
  openGapMap: Map<string, OpenGap>,
  constraintsSecId: string,
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
  const evidenceFrom = (
    rec: Record<string, unknown>,
    fallbackSource: string,
    fallbackMethod: string,
  ): Evidence => {
    const ev = (rec.evidence ?? {}) as Record<string, unknown>;
    const source =
      typeof ev.source === "string" && ev.source.trim()
        ? ev.source.trim()
        : fallbackSource;
    const summary =
      typeof ev.summary === "string" && ev.summary.trim()
        ? ` — ${ev.summary.trim()}`
        : "";
    return { source, method: `${fallbackMethod}${summary}`, checkedAt: nowIso };
  };
  for (const a of list) {
    if (typeof a !== "object" || a === null) continue;
    const rec = a as Record<string, unknown>;
    const itemId = typeof rec.itemId === "string" ? rec.itemId : "";
    const gap = openGapMap.get(itemId);
    if (!gap || handled.has(itemId)) continue;

    if (rec.type === "closeGap") {
      const ev = (rec.evidence ?? {}) as Record<string, unknown>;
      if (!(typeof ev.source === "string" && ev.source.trim())) continue;
      out.push({
        type: "closeGap",
        actor: "research",
        itemId,
        evidence: evidenceFrom(rec, ev.source as string, "read"),
      });
      handled.add(itemId);
    } else if (rec.type === "decide") {
      const constraint =
        typeof rec.constraint === "string" ? rec.constraint.trim() : "";
      if (!constraint || !constraintsSecId) continue;
      const rationale =
        typeof rec.rationale === "string" ? rec.rationale.trim() : "";
      // The decision becomes a CONSTRAINT that inherits the gap's element
      // edges AND its ask (servesEntry) — so it stays ask-anchored and is never
      // orphaned — carrying its rationale as a note.
      out.push({
        type: "proposeItem",
        actor: "research",
        sectionId: constraintsSecId,
        item: {
          text: constraint,
          modality: "mandatory",
          evals: {},
          ...(rationale ? { note: `Decided: ${rationale}` } : {}),
          ...(gap.requires.length ? { requires: [...gap.requires] } : {}),
          ...(gap.servesEntries?.length
            ? { servesEntries: gap.servesEntries }
            : {}),
          // Back-link: dropping this constraint re-opens the gap it settled.
          decidedFrom: itemId,
        },
      });
      // ...and the gap it settles is resolved, recording that the machine
      // decided it (overridable — the human edits the constraint).
      out.push({
        type: "closeGap",
        actor: "research",
        itemId,
        evidence: evidenceFrom(rec, "self-decided (see constraint)", "decided"),
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
