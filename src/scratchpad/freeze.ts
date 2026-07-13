import type { Objection, WorkingModel } from "./model";
import { freezeEnabled, goalSection } from "./model";
import { FROZEN_TEP_STATUS, project } from "./projection";

/**
 * A human-approval token. Any non-null token means "the human approved."
 * Only the UI (FreezeControl) may mint one — the assistant has no path to do so.
 */
export interface ApprovalToken {
  value: string;
}

/**
 * The server-side signing tool that writes the frozen artifact.
 */
export interface SigningTool {
  writeTep(args: {
    thinking_space: string;
    title: string;
    status: string;
    body: string;
  }): Promise<{ tep: string }>;
}

/**
 * Dependencies injected into freeze().
 */
export interface FreezeDeps {
  /** The human-approval token minted by the UI; null if the human has not approved. */
  approval: ApprovalToken | null;
  /** The server-side signing tool. */
  signing: SigningTool;
  /** The thinking space identifier passed to the signing tool. */
  thinkingSpace: string;
}

/**
 * Human-only signed freeze.
 *
 * Throws if:
 *   - `deps.approval` is null (no human approval token provided), or
 *   - `freezeEnabled(model)` is false (coverage or clean-cut requirement not met).
 *
 * Otherwise:
 *   1. Projects the model using the model's tenant.
 *   2. Calls `deps.signing.writeTep` with the goal title, FROZEN_TEP_STATUS, and the body.
 *   3. Returns `{ tep, markedObjections }` where `markedObjections` are the
 *      unresolved objections that were rendered into the body.
 */
export async function freeze(
  model: WorkingModel,
  deps: FreezeDeps,
): Promise<{ tep: string; markedObjections: Objection[] }> {
  if (deps.approval === null) {
    throw new Error("Freeze requires a human approval token: approval is null");
  }

  if (!freezeEnabled(model)) {
    throw new Error(
      "Freeze is not enabled: the model has not passed the readiness check (coverage and clean-cut required)",
    );
  }

  const goal = goalSection(model);
  const title = goal.text.split("\n")[0].trim() || "Untitled";

  const body = project(model, model.tenant);

  const result = await deps.signing.writeTep({
    thinking_space: deps.thinkingSpace,
    title,
    status: FROZEN_TEP_STATUS,
    body,
  });

  const markedObjections = model.objections.filter((o) => !o.resolved);

  return { tep: result.tep, markedObjections };
}
