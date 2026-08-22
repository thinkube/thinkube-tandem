/**
 * The minted-approval helpers over the engine's token machinery: the
 * signed PAIR's content hash (the render the human read + the grounded
 * members underneath), and the token verdict a dispatch consults.
 */
import { Cut, Space } from "../core/schema";
import { renderCutScreen } from "./render";
import { groundingHashOf } from "./sign";
import { approvalContentHash, approvalStatus } from "../engine/approvalToken";
import { ApprovalStore } from "../engine/approvalStore";

export function tepContentHash(
  space: Space,
  cut: { changeIds: string[]; tepId?: string; docsExemption?: { reason: string } },
): string {
  // Rebuilt bare — but carrying the cut's own documentation exemption, so
  // an excused cut hashes a non-empty grounding half and an edited reason
  // changes this hash, invalidating the minted token until the cut is
  // re-signed.
  const bare = {
    id: "pair",
    changeIds: cut.changeIds,
    ...(cut.docsExemption ? { docsExemption: { reason: cut.docsExemption.reason } } : {}),
  };
  const render = renderCutScreen(space, bare);
  // Hashed directly rather than through signCut, which would refuse a
  // cut whose changeIds already match an already-signed cut in this same
  // space — exactly the situation every real caller of this function is
  // in (the cut being hashed is already in space.cuts by then).
  const grounding = groundingHashOf(space, bare);
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
