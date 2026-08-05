/**
 * The two signatures. Signing a cut binds the PAIR: the render the human
 * read and the grounded members underneath it — neither can drift under a
 * signature without the drift being detectable. Accepting a delivery is
 * refused while any proof is not green: acceptance means the evidence was
 * on the table.
 */
import { createHash } from "node:crypto";
import { Cut, Delivery, Space } from "../core/schema";
import { renderCutScreen } from "./render";

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** The grounded half of the pair: members with their grounding, canonical. */
function groundingHashOf(space: Space, cut: Cut): string {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const canonical = [...cut.changeIds]
    .sort()
    .map((id) => {
      const n = byId.get(id);
      return JSON.stringify({
        id,
        sentence: n?.sentence,
        grounding: n?.grounding,
        acceptance: n?.acceptance,
        needs: n?.needs,
      });
    })
    .join("\n");
  return sha(canonical);
}

export type SignResult =
  | { ok: true; cut: Cut }
  | { ok: false; reason: string };

/** The human's first gate. Binds render + grounding at the moment of the click. */
export function signCut(
  space: Space,
  cut: Cut,
  at: string,
  author = "user",
): SignResult {
  if (cut.changeIds.length === 0)
    return { ok: false, reason: "an empty cut cannot be signed" };
  if (cut.signature) return { ok: false, reason: "this cut is already signed" };
  const mine = space.cuts.filter(
    (c) => c.tepId?.startsWith(`TEP-${author}-`) && c.signature,
  ).length;
  return {
    ok: true,
    cut: {
      ...cut,
      tepId: `TEP-${author}-${mine + 1}`,
      signature: {
        at,
        renderHash: sha(renderCutScreen(space, cut)),
        groundingHash: groundingHashOf(space, cut),
      },
    },
  };
}

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; drift: "render" | "grounding"; reason: string };

/** Detects drift under a signature — which half moved, stated plainly. */
export function verifyCutSignature(space: Space, cut: Cut): SignatureVerdict {
  if (!cut.signature) return { ok: false, drift: "render", reason: "the cut is not signed" };
  if (groundingHashOf(space, cut) !== cut.signature.groundingHash)
    return {
      ok: false,
      drift: "grounding",
      reason: "the grounded members changed since the signature",
    };
  if (sha(renderCutScreen(space, cut)) !== cut.signature.renderHash)
    return {
      ok: false,
      drift: "render",
      reason: "the render changed since the signature",
    };
  return { ok: true };
}

export type AcceptResult =
  | { ok: true; delivery: Delivery }
  | { ok: false; reason: string };

/** The human's second gate. Refused while evidence is missing or red. */
export function acceptDelivery(delivery: Delivery, at: string): AcceptResult {
  if (delivery.acceptedAt)
    return { ok: false, reason: "this delivery is already accepted" };
  const notGreen = delivery.proofs.filter((p) => p.verdict !== "green");
  if (delivery.proofs.length === 0)
    return { ok: false, reason: "a delivery with no proof cannot be accepted" };
  if (notGreen.length)
    return {
      ok: false,
      reason: `proof outstanding: ${notGreen.map((p) => `${p.label} (${p.verdict})`).join(", ")}`,
    };
  return { ok: true, delivery: { ...delivery, acceptedAt: at } };
}
