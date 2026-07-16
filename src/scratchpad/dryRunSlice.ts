import type { WorkingModel, SectionKind, ReadinessRecord } from "./model";
import { goalSection } from "./model";
import { uncoveredSections } from "./coverage";

/**
 * The result of a non-committing slice dry run.
 *
 * cleanCut — true when the slicer found a clean decomposition with no gaps.
 * gapSection — the SectionKind (or any string) that caused the gap, or null
 *   when cleanCut is true. Typed as string|null so injected fakes whose return
 *   type uses a separately-compiled SectionKind alias are still assignable.
 * decomposition — the proposed list of work-unit labels/titles.
 */
export interface DryRunResult {
  cleanCut: boolean;
  gapSection: string | null;
  decomposition: string[];
  /** The judge's one-sentence explanation of the gap (absent when cleanCut). */
  reason?: string;
}

/**
 * Injected dependencies for dryRunSlice.
 *
 * runSlicer must NEVER call create_slice or write slice files; it only
 * returns a verdict (cleanCut / gapSection) and the proposed decomposition.
 */
export interface DryRunDeps {
  runSlicer: (intent: string) => Promise<DryRunResult>;
}

/**
 * Invoke the downstream slicer in non-committing mode.
 *
 * Extracts the goal section text and passes it to deps.runSlicer as the
 * "intent" string.  The slicer is responsible for never writing slice files.
 */
export async function dryRunSlice(
  model: WorkingModel,
  deps: DryRunDeps,
): Promise<DryRunResult> {
  const goal = goalSection(model);
  return deps.runSlicer(goal.text);
}

/**
 * Minimal verdict shape needed to build a ReadinessRecord.
 * DryRunResult satisfies this; injected fakes that omit `decomposition` also
 * satisfy it, so session.ts can call toReadinessRecord with a SlicerVerdict.
 */
export interface SlicerVerdict {
  cleanCut: boolean;
  gapSection: string | null;
  /** The judge's one-sentence explanation of the gap (absent when cleanCut). */
  reason?: string;
}

/**
 * Map coverage state and a slicer verdict into the ReadinessRecord that the
 * app stores via the 'recordReadiness' action.
 *
 *   covered    — true iff uncoveredSections(model) is empty
 *   cleanCut   — copied from the verdict
 *   gapSection — copied from the verdict
 */
export function toReadinessRecord(
  model: WorkingModel,
  dry: SlicerVerdict,
): ReadinessRecord {
  const record: ReadinessRecord = {
    covered: uncoveredSections(model).length === 0,
    cleanCut: dry.cleanCut,
    // gapSection is string|null on SlicerVerdict/DryRunResult; the cast is safe
    // because real slicers always return a valid SectionKind string.
    gapSection: dry.gapSection as SectionKind | null,
  };
  if (dry.reason !== undefined && dry.reason.trim()) {
    record.note = dry.reason.trim();
  }
  return record;
}

// ── Production runSlicer (wiring gap found in field use, 2026-07-16) ──────────
// The session's checkReadiness path and the freeze gate were fully built, but no
// production runSlicer was ever injected — probes injected fakes, so freeze
// could NEVER enable in a real session. This default judge closes that gap:
// a blind, non-committing single-shot verdict on the intent's decomposability.

const SECTION_KINDS = new Set([
  "goal",
  "constraints",
  "elements",
  "gap",
  "criteria",
  "verification",
]);

/**
 * Parse a readiness-judge reply into a DryRunResult. Pure; exported for tests.
 * Unparseable or invalid replies return the honest not-ready verdict
 * { cleanCut:false, gapSection:null } — freeze stays locked, never a false green.
 */
export function parseSlicerVerdict(text: string): DryRunResult {
  const notReady: DryRunResult = {
    cleanCut: false,
    gapSection: null,
    decomposition: [],
  };
  const jsonMatch = (text ?? "").match(/\{[\s\S]*\}/);
  if (!jsonMatch) return notReady;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    if (typeof parsed.cleanCut !== "boolean") return notReady;
    const gapSection =
      typeof parsed.gapSection === "string" &&
      SECTION_KINDS.has(parsed.gapSection)
        ? parsed.gapSection
        : null;
    const decomposition = Array.isArray(parsed.decomposition)
      ? parsed.decomposition.filter((d): d is string => typeof d === "string")
      : [];
    // cleanCut:false with no named gap is legal (gapSection null); cleanCut:true
    // always clears the gap.
    const result: DryRunResult = {
      cleanCut: parsed.cleanCut,
      gapSection: parsed.cleanCut ? null : gapSection,
      decomposition,
    };
    if (
      !parsed.cleanCut &&
      typeof parsed.reason === "string" &&
      parsed.reason.trim()
    ) {
      result.reason = parsed.reason.trim();
    }
    return result;
  } catch {
    return notReady;
  }
}

/**
 * Build the production runSlicer: a blind single-shot readiness judge over the
 * intent text. NEVER writes anything (per the DryRunDeps contract) — it only
 * returns a verdict. SDK-absent or failed rounds return not-ready, honestly.
 */
export function makeProductionRunSlicer(
  modelId: string,
): (intent: string) => Promise<DryRunResult> {
  return async (intent: string): Promise<DryRunResult> => {
    const notReady: DryRunResult = {
      cleanCut: false,
      gapSection: null,
      decomposition: [],
    };
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
      return notReady;
    }

    const prompt =
      `You are a readiness judge for a thinking space. This is a NON-COMMITTING dry run: ` +
      `you never write files or create anything — you only return a verdict.\n\n` +
      `Judge whether the intent below is ready to be frozen into a proposal: it decomposes ` +
      `into coherent work with no unresolved ambiguity a downstream planner would have to guess at. ` +
      `The thinking space is domain-agnostic — do not assume a software project or any technology ` +
      `beyond what the intent itself states.\n\n` +
      `Intent and settled items:\n${intent}\n\n` +
      `Respond with EXACTLY ONE JSON object and nothing else:\n` +
      `{"cleanCut": <boolean>, "gapSection": <"constraints"|"elements"|"gap"|"criteria"|"verification"|null>, ` +
      `"reason": "<when cleanCut is false: ONE concrete sentence naming exactly what is missing or ambiguous and what would settle it>", ` +
      `"decomposition": ["<work item title>", ...]}\n` +
      `cleanCut true only when the intent needs no further shaping; when false, name the section ` +
      `whose content is missing or ambiguous in gapSection (or null if the gap is the intent itself), ` +
      `and make "reason" specific enough that the author knows what to write next — never restate the section name.`;

    try {
      let resultText = "";
      let assistantText = "";
      for await (const msg of sdkQuery({
        prompt,
        options: {
          model: modelId,
          permissionMode: "bypassPermissions",
          thinking: { type: "disabled" },
          // Blind judge: verdict from the prompt only — no repo, web, or shell.
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
      return parseSlicerVerdict(resultText || assistantText);
    } catch {
      return notReady;
    }
  };
}
