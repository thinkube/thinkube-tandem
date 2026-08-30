/**
 * A decision changes what the words mean, so the work derives again.
 *
 * One subject: a question is answered, its implications are staged, and
 * accepting one re-derives every subject that answer touches — once,
 * under every decision in force, so two accepted implications of the same
 * ask never cost two passes. It sat in the session class because the
 * surface makes these gestures; it lives here because a file is split at
 * a subject, never shaved.
 */
import { signedIds } from "../core/cutClosure";
import { decideQuestionFlow } from "./captureFlows";
import { groundSubjectFlow } from "./subjectFlow";
import type { TandemSession } from "./session";

export async function acceptQuestionOn(
  s: TandemSession,
  questionId: string,
  editedText?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const r = decideQuestionFlow({
    space: s.space,
    questionId,
    editedText,
    now: s.deps.now(),
    author: s.author,
  });
  if ("reason" in r) return { ok: false, reason: r.reason };
  s.space = r.space;
  s.changed(
    r.staged
      ? "Decision in force — its implication is staged below; accept it to re-derive."
      : "Decision in force.",
  );
  return { ok: true };
}

/** What a decision touches. A question raised while grounding names its
 *  subject; one captured against a sentence names the ask it came from. */
export function subjectsOfAsk(s: TandemSession, id: string): string[] {
  if ((s.space.subjects ?? []).some((x) => x.id === id)) return [id];
  return [
    ...new Set((s.space.claims ?? []).filter((c) => c.fromAsk === id).map((c) => c.subjectId)),
  ];
}

/** Drop the unsigned promises of these subjects, then derive them again.
 *  A promise belongs to a subject either by the claim it serves or by the
 *  subject it was ground for — both, so nothing survives as a duplicate. */
export async function rederiveSubjects(s: TandemSession, ids: string[]): Promise<void> {
  const subjects = new Set(ids);
  const claimIds = new Set(
    (s.space.claims ?? []).filter((c) => subjects.has(c.subjectId)).map((c) => c.id),
  );
  const signed = signedIds(s.space.cuts);
  const goes = new Set(
    s.space.nodes
      .filter(
        (n) =>
          !signed.has(n.id) &&
          ((n.servesClaim && claimIds.has(n.servesClaim)) ||
            n.serves.some((sv) => subjects.has(sv))),
      )
      .map((n) => n.id),
  );
  s.space = { ...s.space, nodes: s.space.nodes.filter((n) => !goes.has(n.id)) };
  // A cut cannot hold a promise that no longer exists.
  for (const id of goes) s.cutNodeIds.delete(id);
  await groundSubjectFlow(s, ids);
}

/** Accept = ONE re-derivation of each subject the decision touches, under
 *  every decision in force; the sibling implications go with it. */
export async function decideImpactOn(
  s: TandemSession,
  impactId: string,
  accept: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  const im = (s.space.impacts ?? []).find((x) => x.id === impactId);
  if (!im) return { ok: false, reason: `no staged impact '${impactId}'` };
  if (!accept) {
    s.space = { ...s.space, impacts: (s.space.impacts ?? []).filter((x) => x.id !== impactId) };
    s.changed("Dismissed — the definitions stay as they are.");
    return { ok: true };
  }
  const covered = (s.space.impacts ?? []).filter((x) => x.askId === im.askId).length;
  s.space = { ...s.space, impacts: (s.space.impacts ?? []).filter((x) => x.askId !== im.askId) };
  const subjects = subjectsOfAsk(s, im.askId);
  if (!subjects.length) return { ok: false, reason: "that ask is not part of any subject" };
  await rederiveSubjects(s, subjects);
  s.changed(
    `Re-derived ${subjects.length} subject(s) under every decision in force` +
      (covered > 1 ? ` — one pass covered ${covered} accepted implications` : "") +
      ".",
  );
  return { ok: true };
}

/** One press for every staged implication: each affected subject derives
 *  again once, five at a time, progress on its own row. */
export async function applyAllImpactsOn(
  s: TandemSession,
): Promise<{ ok: boolean; reason?: string }> {
  const impacts = s.space.impacts ?? [];
  if (!impacts.length) return { ok: false, reason: "no implications are staged" };
  const subjects = [...new Set(impacts.flatMap((im) => subjectsOfAsk(s, im.askId)))];
  s.space = { ...s.space, impacts: [] };
  if (!subjects.length) return { ok: false, reason: "those asks are not part of any subject" };
  await rederiveSubjects(s, subjects);
  s.changed(
    `Applied ${impacts.length} implication(s): ${subjects.length} subject(s) re-derived once each.`,
  );
  return { ok: true };
}
