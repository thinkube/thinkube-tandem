import { createPhaseWorker, GATES } from "./worker";
import type { WorkerFactoryDeps, WorkerRun } from "./worker";
import type { WorkingModel } from "../model";

/**
 * Reframe worker — pre-gated with GATES.reframe.
 * allowed: [editGoal]
 * disallowed: everything else
 *
 * Prompt content rule (SP-21/3 contract): reframe's prompt contains the
 * verbatim text of CHECKED items ONLY and NO unchecked item's text.
 * This is a deliberate departure from a whole-model JSON dump: the reframe
 * worker rewrites the intent exclusively from what the human has settled.
 */
export function reframe(deps: WorkerFactoryDeps): WorkerRun {
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
      const checkedLines: string[] = [];
      for (const section of workingModel.sections) {
        for (const item of section.items) {
          if (item.checked) {
            checkedLines.push(`  [${section.kind}] ${item.text}`);
          }
        }
      }

      const checkedBlock =
        checkedLines.length > 0
          ? checkedLines.join("\n")
          : "(no checked items yet)";

      return (
        `You are the reframe worker. Rewrite the intent (goal) statement from the checked items below.\n\n` +
        `Checked items only:\n${checkedBlock}\n\n` +
        `Produce an editGoal action whose text is a precise, concise goal statement synthesised from these checked items. ` +
        `Do not include any unchecked item's content.`
      );
    },
  };
}
