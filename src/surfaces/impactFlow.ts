/**
 * Staleness, decisions and implications: re-deriving the subjects a
 * decision or a code change touches, one pass per subject, under every
 * decision in force.
 */
import type { TandemSession } from "./session";
import { assessCurrency } from "./currency";
import { groundSubjectFlow } from "./subjectFlow";
import { signedIds } from "../core/cutClosure";
import { decideQuestionFlow, panicFlow } from "./captureFlows";

/** Out-of-date promises re-derive the subject they belong to. */
export async function regroundFlow(s: TandemSession): Promise<void> {
  await refreshStalenessFlow(s);
  const staleSubjects = new Set(
    s.space.nodes
      .filter((n) => s.stale.has(n.id) && n.servesClaim)
      .map((n) => (s.space.claims ?? []).find((c) => c.id === n.servesClaim)?.subjectId)
      .filter((id): id is string => !!id),
  );
  if (!staleSubjects.size) return;
  await rederiveSubjectsFlow(s, [...staleSubjects]);
  await refreshStalenessFlow(s);
  s.changed("Re-read the code and refreshed the out-of-date promises.");
}

export function panicSessionFlow(s: TandemSession): { ok: boolean; reason?: string } {
  if (s.running) return { ok: false, reason: "a run is in flight — stop it first" };
  const r = panicFlow(s.space);
  if ("reason" in r) return { ok: false, reason: r.reason };
  s.space = r.space;
  s.cutNodeIds = new Set();
  s.stale = new Set();
  s.changed("Cleared the derived thinking — your asks are untouched; re-ground when ready.");
  return { ok: true };
}

/**
 * The human's accept on a question: the recommendation (or their edited
 * wording) becomes a DECISION — recorded, injected into every later
 * round, and the affected ask re-grounds under it immediately.
 */
export async function acceptQuestionFlow(
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
export function subjectsOfAskFlow(s: TandemSession, id: string): string[] {
  if ((s.space.subjects ?? []).some((sub) => sub.id === id)) return [id];
  return [
    ...new Set((s.space.claims ?? []).filter((c) => c.fromAsk === id).map((c) => c.subjectId)),
  ];
}

/** Drop the unsigned promises of these subjects, then derive them again.
 *  A promise belongs to a subject either by the claim it serves or by the
 *  subject it was ground for — both, so nothing survives as a duplicate. */
export async function rederiveSubjectsFlow(s: TandemSession, ids: string[]): Promise<void> {
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
          ((n.servesClaim && claimIds.has(n.servesClaim)) || n.serves.some((sv) => subjects.has(sv))),
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
export async function decideImpactFlow(
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
  const subjects = subjectsOfAskFlow(s, im.askId);
  if (!subjects.length) return { ok: false, reason: "that ask is not part of any subject" };
  await rederiveSubjectsFlow(s, subjects);
  s.changed(
    `Re-derived ${subjects.length} subject(s) under every decision in force` +
      (covered > 1 ? ` — one pass covered ${covered} accepted implications` : "") + ".",
  );
  return { ok: true };
}

/** One press for every staged implication: each affected subject derives
 *  again once, five at a time, progress on its own row. */
export async function applyAllImpactsFlow(s: TandemSession): Promise<{ ok: boolean; reason?: string }> {
  const impacts = s.space.impacts ?? [];
  if (!impacts.length) return { ok: false, reason: "no implications are staged" };
  const subjects = [...new Set(impacts.flatMap((im) => subjectsOfAskFlow(s, im.askId)))];
  s.space = { ...s.space, impacts: [] };
  if (!subjects.length) return { ok: false, reason: "those asks are not part of any subject" };
  await rederiveSubjectsFlow(s, subjects);
  s.changed(
    `Applied ${impacts.length} implication(s): ${subjects.length} subject(s) re-derived once each.`,
  );
  return { ok: true };
}

/** A human pin — outranks the computed coupling. Out of date only when a
 *  file the promise lands in changed. */
export async function refreshStalenessFlow(s: TandemSession): Promise<void> {
  const r = await assessCurrency(s.space, {
    repoRoot: s.deps.round.repoRoot,
    readCurrentStamp: s.deps.readCurrentStamp,
    scopeDir: (scope) => s.deps.scopes?.().find((x) => x.id === scope)?.dir,
  });
  s.stale = r.stale;
  s.proofDrift = r.proofDrift;
}
