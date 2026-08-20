/**
 * The two signatures. Signing a cut binds the PAIR: the render the human
 * read and the grounded members underneath it — neither can drift under a
 * signature without the drift being detectable. Signing also always
 * requires documentation or a written exemption; that requirement is not
 * gated by any setting. Accepting a delivery is refused while any proof
 * is not green: acceptance means the evidence was on the table, and its
 * own documentation check is the one setting (`docsGateMode`) governs.
 */
import { createHash } from "node:crypto";
import { Cut, Delivery, Space } from "../core/schema";
import { renderCutScreen } from "./render";
import { docLandings } from "../core/docs";

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
import { danglingNeeds } from "../core/cutClosure";

export function signCut(
  space: Space,
  cut: Cut,
  at: string,
  author = "user",
  tepNumber?: number,
): SignResult {
  if (cut.changeIds.length === 0)
    return { ok: false, reason: "an empty cut cannot be signed" };
  if (cut.signature) return { ok: false, reason: "this cut is already signed" };
  // The freeze refusals: what cannot be proven, placed, or is still an open
  // question is not signable — the cut screen names these before the click.
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const members = cut.changeIds.map((id) => byId.get(id)).filter((n) => !!n);
  const unprovable = members.filter((n) => n!.acceptance.length === 0);
  if (unprovable.length)
    return {
      ok: false,
      reason: `these promises have no check yet: ${unprovable.map((n) => n!.sentence).join("; ")} — open each unit and press "Write a check" first`,
    };
  const ungrounded = members.filter(
    (n) => !n!.grounding || (n!.grounding.touchpoints ?? []).length === 0,
  );
  if (ungrounded.length)
    return {
      ok: false,
      reason: `the machine has not placed these promises in the code yet: ${ungrounded.map((n) => n!.sentence).join("; ")} — press the out-of-date badge to re-read the code`,
    };
  const alreadySigned = new Set(
    space.cuts.filter((c) => c.signature).flatMap((c) => c.changeIds),
  );
  const resigned = members.filter((n) => alreadySigned.has(n!.id));
  if (resigned.length)
    return {
      ok: false,
      reason: `already in a signed work order: ${resigned.map((n) => n!.sentence).join("; ")} — a signed promise is a record; change it by superseding, never by signing twice`,
    };
  const dangling = danglingNeeds(cut.changeIds, space.nodes);
  if (dangling.length)
    return {
      ok: false,
      reason: `depends on promises outside the cut: ${dangling
        .map((d) => `"${d.sentence}" needs ${d.missing.join("; ")}`)
        .join(" · ")} — they ship together`,
    };
  const askIds = new Set(members.flatMap((n) => n!.serves));
  const open = space.questions.filter((q) => !q.decided && askIds.has(q.askId));
  if (open.length)
    return {
      ok: false,
      reason: `undecided question(s) on these asks: ${open.map((q) => q.text).join(" · ")} — decide them before signing`,
    };
  // Signing always requires documentation or a written exemption — this
  // holds regardless of docsGateMode, which governs the accept gate only.
  const exemptionReason = cut.docsExemption?.reason?.trim();
  if (docLandings(space, cut).length === 0 && !exemptionReason)
    return {
      ok: false,
      reason:
        "documentation is missing: this cut lands no page under docs/ — write the documentation, or excuse it with a written reason before signing",
    };
  const mine = space.cuts.filter(
    (c) => c.tepId?.startsWith(`TEP-${author}-`) && c.signature,
  ).length;
  return {
    ok: true,
    cut: {
      ...cut,
      tepId: `TEP-${author}-${tepNumber ?? mine + 1}`,
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

/** The human's second gate. Refused while evidence is missing or red. The
 *  documentation requirement itself is signing's job, always enforced,
 *  never gated by a setting — `docsGateMode` governs only THIS gate's
 *  handling of an unmet obligation surfaced on the delivery (block by
 *  default; advisory is the recorded escape hatch). */
export function acceptDelivery(
  delivery: Delivery,
  at: string,
  docsGateMode: "blocking" | "advisory" = "blocking",
): AcceptResult {
  if (delivery.acceptedAt)
    return { ok: false, reason: "this delivery is already accepted" };
  if (delivery.withheld)
    return { ok: false, reason: `this delivery was withheld — ${delivery.withheld}` };
  const notGreen = delivery.proofs.filter((p) => p.verdict !== "green");
  if (delivery.proofs.length === 0)
    return { ok: false, reason: "a delivery with no proof of its checks cannot be accepted" };
  if (notGreen.length)
    return {
      ok: false,
      reason: `proof outstanding: ${notGreen.map((p) => `${p.label} (${p.verdict})`).join(", ")}`,
    };
  const docsUnmet = (delivery.undelivered ?? []).filter((u) =>
    u.includes("docs obligation unmet"),
  );
  if (docsGateMode === "blocking" && docsUnmet.length)
    return {
      ok: false,
      reason: `the docs gate blocks this accept: ${docsUnmet.join(" · ")}`,
    };
  return { ok: true, delivery: { ...delivery, acceptedAt: at } };
}
