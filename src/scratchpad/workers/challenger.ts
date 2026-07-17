// src/scratchpad/workers/challenger.ts — assumption enforcement (2026-07-17).
//
// When a standing assumption lands ("this is a single-user development
// platform"), existing items authored before it may contradict it (output
// redaction, multi-tenant hardening…). The challenger applies the assumption
// retroactively — and NEVER destructively: contradicting items come back as a
// STAGED SELECTION (the human applies Drop/Defer from the selection bar),
// reconcilable items as proposeEdits (human resolves), and every finding as a
// note naming the contradicted assumption.

import type { Action, WorkingModel } from "../model";
import { GATES, renderGroundingBlocks } from "./worker";
import type { QueryFn } from "./worker";
import { normalizeWorkerActions, renderActionGuide } from "./actionGuide";

export interface ChallengerResult {
  /** Notes + proposeEdits (apply directly — both are non-destructive). */
  actions: Action[];
  /** Items contradicting the assumption — staged, never touched. */
  selectedItemIds: string[];
}

/** Build the challenger prompt. Pure; exported for tests. */
export function buildChallengerPrompt(
  model: WorkingModel,
  contextDigest?: string,
): string {
  const assumptions = model.assumptions ?? [];
  const newest =
    assumptions.length > 0 ? assumptions[assumptions.length - 1].text : "";
  const itemLines: string[] = [];
  for (const section of model.sections) {
    if (section.kind === "goal") continue;
    for (const item of section.items) {
      if (item.state !== "active") continue;
      itemLines.push(
        `- [${section.kind}] itemId "${item.id}": "${item.text}"`,
      );
    }
  }
  return (
    `You are the CHALLENGER. A new standing assumption just landed and existing items were ` +
    `authored before it — your job is to apply it retroactively.\n\n` +
    `NEWEST ASSUMPTION (apply this one): "${newest}"` +
    renderGroundingBlocks(model, contextDigest) +
    `\n\nActive items:\n${itemLines.join("\n")}\n\n` +
    `For each item, decide:\n` +
    `- CONTRADICTS the assumption and should not survive as-is → put its itemId in the top-level ` +
    `"select" array (the human decides its fate from the staged set — you never drop anything).\n` +
    `- Reconcilable by rewording → emit a proposeEdit with the reconciled text.\n` +
    `- Either way, emit an addItemNote naming the conflict: "Challenged by assumption: <quote> — <why>".\n` +
    `- Consistent with the assumption → leave it alone entirely.\n` +
    `Be conservative: a false challenge wastes the human's attention; only flag REAL conflicts.\n\n` +
    renderActionGuide(model, GATES.challenger.allowedTools, "integrator") +
    `\n\nRespond with ONE JSON object: {"actions":[...], "select":["<itemId of each contradicting item>", ...]}`
  );
}

/** Run the challenger round. Non-destructive by construction. */
export async function runChallenger(
  deps: { loadQuery: () => QueryFn; model: string; contextDigest?: string },
  model: WorkingModel,
): Promise<ChallengerResult> {
  const options = {
    model: deps.model,
    allowedTools: GATES.challenger.allowedTools,
    disallowedTools: GATES.challenger.disallowedTools,
  };
  const prompt = buildChallengerPrompt(model, deps.contextDigest);
  const query = deps.loadQuery();
  const rawActions: Action[] = [];
  const rawSelect: string[] = [];
  for await (const msg of query({ prompt, options })) {
    if (msg.type === "actions") {
      rawActions.push(...msg.actions);
      if (msg.select) rawSelect.push(...msg.select);
    }
  }
  const { valid } = normalizeWorkerActions(rawActions as unknown[], model, {
    defaultActor: "integrator",
    allowedTools: GATES.challenger.allowedTools,
  });
  const liveIds = new Set(
    model.sections.flatMap((s) =>
      s.items.filter((it) => it.state === "active").map((it) => it.id),
    ),
  );
  return {
    actions: valid,
    selectedItemIds: [...new Set(rawSelect.filter((id) => liveIds.has(id)))],
  };
}
