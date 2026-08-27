/**
 * The minted-approval helpers over the engine's token machinery: the
 * signed PAIR's content hash (the render the human read + the grounded
 * members underneath), and the token verdict a dispatch consults.
 */
import { Cut, Space } from "../core/schema";
import { renderCutScreen } from "./render";
import { signCut } from "./sign";
import { approvalContentHash, approvalStatus } from "../engine/approvalToken";
import { ApprovalStore } from "../engine/approvalStore";

export function tepContentHash(
  space: Space,
  cut: { changeIds: string[]; tepId?: string; docsExemption?: { reason: string; at: string } },
): string {
  const pair: Cut = { id: "pair", changeIds: cut.changeIds, docsExemption: cut.docsExemption };
  const render = renderCutScreen(space, pair);
  const sig = signCut(space, pair, "t", "x");
  const grounding = sig.ok ? sig.cut.signature!.groundingHash : "";
  return approvalContentHash(`${render}\u0000${grounding}`);
}

export function tepApprovalOf(
  space: Space,
  approvals: ApprovalStore,
  secret: Buffer,
  tepId: string,
): { approved: boolean; reason?: string } {
  const cut: Cut | undefined = space.cuts.find((c) => c.tepId === tepId);
  if (!cut) return { approved: false, reason: "unknown TEP" };
  const status = approvalStatus(approvals.get(`tep:${tepId}`), {
    subjectKey: `tep:${tepId}`,
    contentHash: tepContentHash(space, cut),
    secret,
  });
  return status.ok ? { approved: true } : { approved: false, reason: status.reason };
}
