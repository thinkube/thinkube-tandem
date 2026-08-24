/**
 * The minted-approval helpers over the engine's token machinery: the
 * approval's content hash, and the token verdict a dispatch consults.
 *
 * Bound to the grounded half alone -- the promises, where they land, what
 * proves them -- never to the cut screen's own wording. The screen is
 * redrawn whenever it gains a line (as it did for the Documentation
 * line): that is the page changing, not the promises, and it must not
 * re-arm a gate a person already signed. signCut and verifyCutSignature
 * draw the same line between the two halves; this hash follows it rather
 * than deriving its own from the render.
 */
import { Cut, Space } from "../core/schema";
import { signCut } from "./sign";
import { approvalContentHash, approvalStatus } from "../engine/approvalToken";
import { ApprovalStore } from "../engine/approvalStore";

export function tepContentHash(
  space: Space,
  cut: { changeIds: string[]; tepId?: string; docsWaiver?: { reason: string; at: string } },
): string {
  const sig = signCut(
    space,
    { id: "pair", changeIds: cut.changeIds, ...(cut.docsWaiver ? { docsWaiver: cut.docsWaiver } : {}) },
    "t",
    "x",
  );
  const grounding = sig.ok ? sig.cut.signature!.groundingHash : "";
  return approvalContentHash(grounding);
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
