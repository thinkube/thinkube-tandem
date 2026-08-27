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
        // WHERE the promise lands, not when it was read there. A stamp
        // records the tree's head at grounding time and an evidence line
        // records what the grounder saw; both move whenever the repository
        // moves, and neither is something a person signed. Hashing them made
        // every commit invalidate every signature in the space.
        grounding: (n?.grounding?.touchpoints ?? []).map((t) => ({
          path: t.path,
          symbol: t.symbol,
          planned: t.planned,
          scope: t.scope,
        })),
        // What a criterion SAYS is signed; where its proof later lived is
        // evidence ABOUT it, written by the run after the fact. Hashing the
        // proof made every delivery invalidate the signature that authorised
        // it, so a second run of the same cut refused itself.
        acceptance: (n?.acceptance ?? []).map((a) => ({
          id: a.id,
          text: a.text,
          kind: a.kind,
          probePath: a.probePath,
        })),
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
import { danglingNeeds, signedIds } from "../core/cutClosure";

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
  // A promise with no check is unsignable — unless everything it says is
  // an observation the person certifies on the delivery. Then it has
  // nothing to prove and is accepted knowingly, listed on the cut review;
  // refusing it would demand a check for what the design says must never
  // be a check.
  const unprovable = members.filter((n) => n!.acceptance.length === 0 && !(n!.unverified?.length));
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
  // A withdrawn cut freezes nothing: its promises were released to be
  // thought through again, and the same set must be signable as new work.
  const alreadySigned = signedIds(space.cuts);
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
        rule: SIGNATURE_RULE,
      },
    },
  };
}

/** The current hashing rule. Raised whenever what is hashed changes. */
const SIGNATURE_RULE = 2;

export type SignatureVerdict =
  | { ok: true; unchecked?: string }
  | { ok: false; drift: "render" | "grounding"; reason: string };

/** Detects drift under a signature — which half moved, stated plainly. */
export function verifyCutSignature(space: Space, cut: Cut): SignatureVerdict {
  if (!cut.signature) return { ok: false, drift: "render", reason: "the cut is not signed" };
  if ((cut.signature.rule ?? 1) !== SIGNATURE_RULE)
    return {
      ok: true,
      unchecked:
        "this cut was signed before the machine changed what a signature covers, so drift cannot be told from that change — it is not checked",
    };
  if (groundingHashOf(space, cut) !== cut.signature.groundingHash)
    return {
      ok: false,
      drift: "grounding",
      reason: "the grounded members changed since the signature",
    };
  // The grounded half held, so WHAT WAS APPROVED has not changed: the
  // sentences, where each lands, every check's own words, and what each
  // needs are all as they were signed. What is left in the render is the
  // page those facts are drawn on — its wording, its ordering, its
  // sections — and that moves whenever the drawing code moves, which
  // nobody signed and nobody changed on purpose.
  //
  // This file has learned the same lesson twice above: hashing the
  // grounding stamp made every commit invalidate every signature, and
  // hashing the proof path made every delivery invalidate the signature
  // that authorised it. A render hash is the third, and it refused a
  // re-run of a cut whose work was already built and proved.
  //
  // So it is said, never refused. A difference here is worth knowing —
  // the page a person read is not the page they would read now — and it
  // is not the promises changing.
  if (sha(renderCutScreen(space, cut)) !== cut.signature.renderHash)
    return {
      ok: true,
      unchecked:
        "the cut reads differently now than when it was signed, though every promise, where it lands and what proves it are unchanged — " +
        "the page was redrawn, not the work",
    };
  return { ok: true };
}

export type AcceptResult =
  | { ok: true; delivery: Delivery }
  | { ok: false; reason: string };

/** The human's second gate. Refused while evidence is missing or red; the
 *  docs gate blocks by default (advisory is the recorded escape hatch). */
/**
 * Accept a delivery — and, when its cut spans more than one repository,
 * accept it as ONE thing.
 *
 * A cut landing in three repositories is built on three branches and opens
 * three deliveries; accepting one of them merges a third of a promise and
 * leaves the person to remember the rest. So a delivery of a cut whose
 * other repositories have not delivered, or are withheld, is refused with
 * those repositories named. Nothing is accepted piecemeal.
 */
export function acceptDelivery(
  delivery: Delivery,
  at: string,
  docsGateMode: "blocking" | "advisory" = "blocking",
  /** The cut's other deliveries, when it spans repositories. */
  siblings: readonly Delivery[] = [],
): AcceptResult {
  if (delivery.acceptedAt)
    return { ok: false, reason: "this delivery is already accepted" };
  if (delivery.withheld)
    return { ok: false, reason: `this delivery was withheld — ${delivery.withheld}` };
  if (delivery.proofs.length === 0)
    return { ok: false, reason: "a delivery with no proof of its checks cannot be accepted" };
  // Only a red CHECK of the cut's own promises refuses the accept: an
  // unkept promise is the one thing that must never be handed over. A red
  // review or a red suite opinion with every actor spent rides the page as
  // a finding — the person reading it IS the actor, and this press is the
  // act. Refusing here made every finding a veto through the back door.
  const notGreen = delivery.proofs.filter((p) => p.verdict !== "green" && p.kind === "probe");
  if (notGreen.length)
    return {
      ok: false,
      reason: `proof outstanding: ${notGreen.map((p) => `${p.label} (${p.verdict})`).join(", ")}`,
    };
  const open = siblings.filter(
    (d) => d.id !== delivery.id && d.cutId === delivery.cutId && !d.acceptedAt,
  );
  if (open.length)
    return {
      ok: false,
      reason:
        `this work also lands in ${open.length} other repository/repositories, and ${open
          .map((d) => `${d.branch}${d.withheld ? " (withheld)" : ""}`)
          .join(", ")} ${open.length === 1 ? "is" : "are"} not accepted yet. ` +
        `It is one piece of work: accept it when every part of it is ready.`,
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
