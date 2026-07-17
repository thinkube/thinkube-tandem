import { createPhaseWorker, GATES } from "./worker";
import type { WorkerFactoryDeps, WorkerRun } from "./worker";
import type { WorkingModel } from "../model";
import { renderActionGuide } from "./actionGuide";
import { renderGroundingBlocks } from "./worker";
import { orderedGateElements } from "../projection";

/**
 * Reframe worker — pre-gated with GATES.reframe.
 * allowed: [curateIntent]   (2026-07-16 redesign: reframe MAINTAINS THE
 * CURATED INTENT — it never again edits the human's goal/rough words.)
 * disallowed: everything else, editGoal explicitly included.
 *
 * Prompt content rule (SP-21/3 contract, preserved): the prompt contains the
 * verbatim text of CHECKED items ONLY and NO unchecked item's text — plus the
 * human's rough requests (their raw asks, which the curated intent must
 * cover). With a cut scope, only checked items INSIDE the cut are shown, so
 * the curated intent describes the upcoming TEP, not the whole space.
 */
export function reframe(
  deps: WorkerFactoryDeps,
  scope?: { itemIds: ReadonlySet<string> },
): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.reframe.allowedTools,
    disallowedTools: GATES.reframe.disallowedTools,
  });

  return {
    ...base,
    buildPrompt(workingModel: WorkingModel, _conversation: string[]): string {
      // Collect only checked items — unchecked text must never appear.
      // With a cut scope, only checked items inside the cut are shown.
      const checkedLines: string[] = [];
      for (const section of workingModel.sections) {
        for (const item of section.items) {
          // Active only: shipped items belong to past TEPs, resolved gaps are
          // answered questions, deferred/dropped are out — none may leak into
          // the curated intent.
          if (!item.checked || item.state !== "active") continue;
          if (scope !== undefined && !scope.itemIds.has(item.id)) continue;
          checkedLines.push(`  [${section.kind}] ${item.text}`);
        }
      }

      const checkedBlock =
        checkedLines.length > 0
          ? checkedLines.join("\n")
          : "(no checked items yet)";

      const requests = workingModel.roughRequests ?? [];
      const goalText =
        workingModel.sections.find((s) => s.kind === "goal")?.text ?? "";
      // NUMBERED journal — the human's raw asks are the non-derived anchor;
      // every commitment must trace to entry numbers.
      const journal = [
        ...(goalText.trim() ? [goalText.trim()] : []),
        ...requests.map((r) => r.text),
      ];
      const requestsBlock =
        journal.length > 0
          ? journal.map((t, i) => `  ${i + 1}. ${t}`).join("\n")
          : "  (none)";

      // Labeled SHIPPING ELEMENTS — precision's forward trace targets. With a
      // cut scope, only the cut's elements; labels (E1..) are positional in
      // document order, the same rule impactCoverage recomputes.
      const shipping = orderedGateElements(
        workingModel,
        scope !== undefined ? [...scope.itemIds] : undefined,
      );
      const elementsBlock =
        shipping.length > 0
          ? shipping.map((e, i) => `  E${i + 1}. "${e.text}"`).join("\n")
          : "  (none)";

      return (
        `You are the reframe worker. Synthesize the CURATED INTENT${scope ? " for the current CUT (an upcoming TEP)" : ""}: ` +
        `a precise, concise statement of what ${scope ? "this selection" : "this thinking space"} intends, ` +
        `grounded in the settled (checked) items below and covering the human's rough requests. ` +
        `You NEVER edit the human's words — the curated intent is a separate, derived statement.\n\n` +
        `Rough requests (the human's raw asks — the curated intent must cover ${scope ? "the ones this cut addresses" : "ALL of them"}):\n${requestsBlock}` +
        renderGroundingBlocks(workingModel, deps.contextDigest) +
        `\n\n` +
        `Shipping elements (use these labels in [delivered-by:]):\n${elementsBlock}\n\n` +
        `Checked items only${scope ? " (inside the cut)" : ""}:\n${checkedBlock}\n\n` +
        `Produce ONE curateIntent action carrying BOTH:\n` +
        `- "title": a crisp headline for the TEP, MAX 80 CHARACTERS — a name, not a summary.\n` +
        `- "text": the curated intent in EXACTLY this shape:\n` +
        `    <1-2 sentences of synthesis — what this adds up to and why>\n` +
        `    (blank line)\n` +
        `    - <commitment — one decidable claim a spec author can turn into an acceptance criterion> [serves: <journal entry numbers>] [delivered-by: <element labels>]\n` +
        `    - <next commitment> [serves: …] [delivered-by: …]\n` +
        `  EVERY bullet must end with BOTH traces: [serves: n, m] to the numbered journal entries, and ` +
        `[delivered-by: E1, E3] to the labeled shipping elements below. A commitment serving no entry does not belong; ` +
        `an entry in scope served by no commitment is a gap you must not paper over; a commitment no element delivers ` +
        `is a promise without a carrier; a shipping element no commitment references is unattributed scope — reference every element.\n` +
        `Gap items are OPEN QUESTIONS, never content: do NOT copy or enumerate them in the intent — ` +
        `the intent states what will be delivered and under which constraints/criteria. ` +
        `Do not include any unchecked item's content.\n\n` +
        renderActionGuide(workingModel, GATES.reframe.allowedTools, "integrator")
      );
    },
  };
}
