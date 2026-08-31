/**
 * A delivery that was not handed over, on the record.
 *
 * Nothing is opened and nothing can be accepted, but a withheld run is
 * still a run and its report is still read — so it carries the same
 * identity a handed-over one does, and everything the machine could not
 * settle rides it the same way. Written three times over, each copy
 * carried a different subset: two of them dropped the observations the
 * person was asked to certify and the findings nobody else could settle,
 * which are exactly what a reader of a withheld report needs.
 */
import type { Cut, Delivery, Proof, Ruling } from "../core/schema";

/**
 * Judgements left standing when every actor is spent, said for the person.
 *
 * A red REVIEW is not a veto: the person at Accept is the only actor left
 * who could satisfy it, so it rides the delivery by name. That reading must
 * come from the PROOFS, not from the unkept list — a promise the machine
 * minted for itself is kept out of `unkept` precisely so it can never
 * withhold, and reading the same list for findings dropped it from both.
 * A red one then left the gate in silence: not a veto, not a finding, one
 * ✗ under a hundred and eighty ticks. Informing instead of vetoing is only
 * worth anything if it informs.
 */
export function unsettledReviews(proofs: readonly Proof[]): { label: string; line: string }[] {
  return proofs
    .filter((p) => p.kind !== "probe" && p.verdict === "red")
    .map((p) => ({
      label: p.label,
      line: `${p.label}${p.ref ? ` — ${p.ref.split("\n")[0].slice(0, 200)}` : ""}`,
    }));
}

export function withheldDelivery(a: {
  tep: string;
  cut: Cut;
  branch: string;
  runId: string;
  producedAt: string;
  proofs: Proof[];
  /** Why it stopped, in the person's terms — never internals. */
  reason: string;
  observations?: readonly string[];
  findings?: readonly string[];
  undelivered?: readonly string[];
  rulings?: readonly Ruling[];
  decisions?: readonly { unit: string; text: string }[];
}): Delivery {
  return {
    id: `delivery-${a.tep}`,
    cutId: a.cut.id,
    branch: a.branch,
    runId: a.runId,
    producedAt: a.producedAt,
    proofs: a.proofs,
    withheld: a.reason,
    ...(a.observations?.length ? { observations: [...a.observations] } : {}),
    ...(a.findings?.length ? { findings: [...a.findings] } : {}),
    ...(a.undelivered?.length ? { undelivered: [...a.undelivered] } : {}),
    ...(a.rulings?.length ? { rulings: [...a.rulings] } : {}),
    ...(a.decisions?.length ? { decisions: [...a.decisions] } : {}),
  };
}
