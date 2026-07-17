// src/scratchpad/workers/contextualizer.ts — the context layer (2026-07-17).
//
// Field finding: blind workers decompose the journal from text alone, producing
// generic plausibility ("thinking NEAR the problem instead of ABOUT it"). The
// fix is NOT un-blinding (ambient reads are untraceable flavor — the .221
// lesson) but a SANCTIONED context channel: a round with read tools over
// DECLARED sources produces a bounded, citable digest dossier; every
// generative round then receives that digest verbatim, marked as context.
// Provenance survives: anything a worker knows beyond the journal is a line
// in a digest the human can open.

import type { WorkingModel } from "../model";
import type { DossierStore } from "./research";

/** Space-relative ref where the digest lives (via the dossier store). */
export const CONTEXT_DIGEST_TOPIC = "_context-digest";
export const CONTEXT_DIGEST_REF = `research/${CONTEXT_DIGEST_TOPIC}.md`;

export interface ContextualizerDeps {
  loadQuery: () => import("./worker").QueryFn;
  model: string;
  dossier: DossierStore;
  /** Declared context sources (absolute paths) — the ONLY places the round
   *  may read. Typically [workspaceRoot, <sidecarRoot>/<namespace>]. */
  sources: string[];
}

/** Build the contextualize prompt. Pure; exported for tests. */
export function buildContextualizePrompt(
  model: WorkingModel,
  sources: string[],
  existingDigest: string | undefined,
): string {
  const goalText =
    model.sections.find((s) => s.kind === "goal")?.text.trim() ?? "";
  const journal = [
    ...(goalText ? [goalText] : []),
    ...(model.roughRequests ?? []).map((r) => r.text),
  ];
  const journalBlock =
    journal.length > 0
      ? journal.map((t, i) => `${i + 1}. ${t}`).join("\n")
      : "(empty)";
  const assumptionsBlock = (model.assumptions ?? [])
    .map((a, i) => `${i + 1}. ${a.text}`)
    .join("\n");

  return (
    `You are the CONTEXTUALIZER for a thinking space. Your only output is a CONTEXT DIGEST: ` +
    `a bounded markdown document describing what ALREADY EXISTS that is relevant to the journal below, ` +
    `so that later (blind) worker rounds decompose against reality instead of inventing plausible generalities.\n\n` +
    `DECLARED SOURCES (the ONLY places you may read — cite them):\n${sources.map((s) => `- ${s}`).join("\n")}\n\n` +
    `Journal (the human's asks, numbered):\n${journalBlock}\n\n` +
    (assumptionsBlock
      ? `Standing assumptions (human statements — the digest must not contradict them):\n${assumptionsBlock}\n\n`
      : "") +
    (existingDigest
      ? `EXISTING DIGEST (you are REFRESHING it — keep what still holds, correct what changed):\n${existingDigest}\n\n`
      : "") +
    `Digest rules:\n` +
    `- HARD BUDGET: at most ~5 KB of markdown. Fewer, sharper facts beat coverage.\n` +
    `- Every claim cites its source path (file or directory) in parentheses.\n` +
    `- Cover ONLY what the journal makes relevant: existing components and where they live, ` +
    `standing constraints and prior decisions (TEPs/retros/defect lessons), and an explicit ` +
    `"exists already vs genuinely new" split for the journal's asks.\n` +
    `- State uncertainty honestly ("not found in sources") rather than guessing.\n` +
    `- NO recommendations, NO proposals, NO items — facts about what exists, only.\n\n` +
    `Respond with ONLY the digest markdown (no preamble, no fences).`
  );
}

/**
 * Run the contextualize round: read-tools over the declared sources, digest
 * written through the dossier store. Returns the dossierRef, or undefined on
 * failure (fail-soft — the space simply stays context-blind until retried).
 */
export async function runContextualize(
  deps: ContextualizerDeps,
  model: WorkingModel,
): Promise<string | undefined> {
  const existing = await deps.dossier.read(CONTEXT_DIGEST_TOPIC);
  const prompt = buildContextualizePrompt(model, deps.sources, existing);

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
    return undefined;
  }

  try {
    let resultText = "";
    let assistantText = "";
    for await (const msg of sdkQuery({
      prompt,
      options: {
        model: deps.model,
        permissionMode: "bypassPermissions",
        thinking: { type: "disabled" },
        // Read-only over the declared sources; NO mutation, no web (context
        // is what exists HERE, not what the internet says — research covers
        // the outside world separately, with its own provenance).
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
        for (const b of content as Array<Record<string, unknown>>) {
          if (b.type === "text" && typeof b.text === "string") {
            assistantText += b.text;
          }
        }
      } else if (rec.type === "result" && typeof rec.result === "string") {
        resultText = rec.result;
      }
    }
    const digest = (resultText || assistantText).trim();
    if (!digest) return undefined;
    // Enforce the budget mechanically — a bloated digest pollutes every
    // downstream prompt. Clip with an honest marker.
    const bounded =
      digest.length <= 6144
        ? digest
        : `${digest.slice(0, 6144)}\n\n> [digest clipped at 6 KB — refresh with a tighter focus]`;
    const { dossierRef } = await deps.dossier.write(
      CONTEXT_DIGEST_TOPIC,
      bounded,
    );
    return dossierRef;
  } catch {
    return undefined;
  }
}

/**
 * Respond-only round for "question"-classified utterances (2026-07-17): a
 * blind answer grounded in the space + digest + assumptions. No actions, no
 * writes — just prose for the chat/command surface.
 */
export async function runQuestionAnswer(
  deps: { model: string },
  question: string,
  model: WorkingModel,
  contextDigest?: string,
): Promise<string | undefined> {
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
    return undefined;
  }
  const goalText =
    model.sections.find((s) => s.kind === "goal")?.text.trim() ?? "";
  const items = model.sections
    .filter((s) => s.kind !== "goal")
    .flatMap((s) =>
      s.items
        .filter((it) => it.state !== "dropped")
        .map(
          (it) =>
            `- [${s.kind}]${it.checked ? " ✓" : ""} ${it.text}`,
        ),
    )
    .join("\n");
  const prompt =
    `Answer the human's question about their thinking space, grounded ONLY in the material below. ` +
    `Be concise (a few sentences). If the material does not answer it, say so plainly.\n\n` +
    `Goal:\n${goalText}\n\nItems:\n${items}\n` +
    (model.assumptions?.length
      ? `\nStanding assumptions:\n${model.assumptions.map((a, i) => `${i + 1}. ${a.text}`).join("\n")}\n`
      : "") +
    (contextDigest ? `\nContext digest:\n${contextDigest.slice(0, 4000)}\n` : "") +
    (model.curatedIntent ? `\nCurated intent:\n${model.curatedIntent}\n` : "") +
    `\nQuestion: ${question}`;
  try {
    let resultText = "";
    let assistantText = "";
    for await (const msg of sdkQuery({
      prompt,
      options: {
        model: deps.model,
        permissionMode: "bypassPermissions",
        thinking: { type: "disabled" },
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
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        const content = Array.isArray(m?.content) ? m!.content : [];
        for (const b of content as Array<Record<string, unknown>>) {
          if (b.type === "text" && typeof b.text === "string") {
            assistantText += b.text;
          }
        }
      } else if (rec.type === "result" && typeof rec.result === "string") {
        resultText = rec.result;
      }
    }
    const answer = (resultText || assistantText).trim();
    return answer || undefined;
  } catch {
    return undefined;
  }
}

