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
import { signCut, verifyCutSignature } from "./sign";
import { approvalContentHash, approvalStatus } from "../engine/approvalToken";
import { ApprovalStore } from "../engine/approvalStore";

/** The grounded half of the pair, as this space stands now. */
function groundingOf(
  space: Space,
  cut: { changeIds: string[]; docsWaiver?: { reason: string; at: string } },
): string {
  const sig = signCut(
    space,
    { id: "pair", changeIds: cut.changeIds, ...(cut.docsWaiver ? { docsWaiver: cut.docsWaiver } : {}) },
    "t",
    "x",
  );
  return sig.ok ? sig.cut.signature!.groundingHash : "";
}

export function tepContentHash(
  space: Space,
  cut: { changeIds: string[]; tepId?: string; docsWaiver?: { reason: string; at: string } },
): string {
  return approvalContentHash(groundingOf(space, cut));
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
  if (status.ok) return { approved: true };
  // The token no longer matches what this gate computes. A token carries
  // the hash minted with it, so every change to what the hash covers --
  // this work moved it off the rendered page and onto the grounded half --
  // stops every approval already in the store from matching. The promises
  // did not move; the rule did.
  //
  // Before refusing, ask the SIGNATURE, which binds the same two halves and
  // can tell those cases apart where one opaque content hash cannot. A cut
  // whose signature still verifies was approved for exactly the promises
  // about to run: the grounded half is unchanged, and any difference is in
  // the page's own wording, which nobody signed and nobody edited.
  //
  // Refusing such a run strands it with no gesture that recovers -- the
  // sign gate refuses promises already in a signed work order, so "sign it
  // again" is advice that cannot be taken.
  //
  // Nothing unsigned is trusted by this: an unsigned cut, a cut whose
  // grounded members moved, or a token that fails its HMAC or names another
  // subject all still refuse, because verifyCutSignature refuses the first
  // two and the reason below carries the last.
  if (status.reason === "content-mismatch" && cut.signature && verifyCutSignature(space, cut).ok)
    return { approved: true };
  return { approved: false, reason: status.reason };
}
