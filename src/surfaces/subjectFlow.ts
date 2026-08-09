/**
 * Grounding a subject: the whole subject at once, under every rule in
 * force, so one round sees everything that must become true of it and
 * produces one coherent set of promises. Each promise names the claim it
 * makes true — the link that scopes every later re-derivation and makes a
 * promise serving nothing visible as scope creep.
 */
import { Change, Space } from "../core/schema";
import { runDerivationPipeline } from "../derive/pipeline";
import type { TandemSession } from "./session";

/** The claims of one subject, in the order the prompt will number them. */
function claimsOf(space: Space, subjectId: string): { id: string; text: string; why?: string }[] {
  return (space.claims ?? [])
    .filter((c) => c.subjectId === subjectId)
    .map((c) => ({ id: c.id, text: c.text, ...(c.why ? { why: c.why } : {}) }));
}

/** The rules governing a subject, as the sentences a round derives under. */
function rulesFor(space: Space, subjectId: string): string[] {
  return (space.rules ?? [])
    .filter((r) => r.governs.includes(subjectId))
    .map((r) => r.text);
}

/** One subject's grounding, appended to the PRESENT space. */
async function groundSubject(
  s: TandemSession,
  subjectId: string,
): Promise<{ promises: number; questions: number }> {
  const subject = (s.space.subjects ?? []).find((x) => x.id === subjectId);
  if (!subject) return { promises: 0, questions: 0 };
  const claims = claimsOf(s.space, subjectId);
  if (!claims.length) return { promises: 0, questions: 0 };

  const ground = s.deps.ground ?? runDerivationPipeline;
  const askText =
    `${subject.name} — what must become true of it:\n` +
    claims.map((c, i) => `${i + 1}. ${c.text}${c.why ? ` (so that ${c.why})` : ""}`).join("\n");

  const grounded = await ground(
    { ...s.deps.round },
    { id: subjectId, text: askText, at: s.deps.now() },
    {
      nextIndex: 1,
      decisions: [...s.decisionsInForce(), ...rulesFor(s.space, subjectId)],
      claims,
      digestStore: s.digests(),
      mintNodeId: (n) => `node-${s.author}-${subjectId.split("-").pop()}-${n}`,
      ...(s.deps.scopes ? { scopes: s.deps.scopes() } : {}),
      onStage: s.stageOf(subjectId),
    },
  );

  const questions = grounded.questions.map((q, i) => ({
    ...q,
    id: `q-${s.author}-${s.space.questions.length + i + 1}`,
  }));
  // Applied to the PRESENT space: a long round never replaces state with a
  // copy of its past.
  s.space = {
    ...s.space,
    nodes: [...s.space.nodes, ...(grounded.changes as Change[])],
    questions: [...s.space.questions, ...questions],
  };
  return { promises: grounded.changes.length, questions: questions.length };
}

/** Ground several subjects, five at a time, each on its own row. */
export async function groundSubjectFlow(s: TandemSession, subjectIds: string[]): Promise<void> {
  if (!subjectIds.length) return;
  const pool = Math.min(5, subjectIds.length);
  for (const id of subjectIds) s.mark(id, "waiting");
  s.changed(
    `Thinking about ${pool} subject${pool === 1 ? "" : "s"}` +
      (subjectIds.length > pool ? `; the other ${subjectIds.length - pool} wait their turn` : "") +
      ".",
  );
  await s.warmRepoDigest();

  let next = 0;
  let done = 0;
  const tally = { promises: 0, questions: 0 };
  const worker = async (): Promise<void> => {
    for (;;) {
      // The index is taken BEFORE the await. Reading the shared counter
      // afterwards clears whichever subject the pool has moved on to, and
      // leaves this one marked as still thinking for ever.
      const i = next++;
      if (i >= subjectIds.length) return;
      const t = await groundSubject(s, subjectIds[i]);
      tally.promises += t.promises;
      tally.questions += t.questions;
      s.clear(subjectIds[i]);
      // Written as it arrives. Thinking is the expensive part, and a
      // reload or a crash midway through must not throw away objects that
      // were already paid for.
      done++;
      s.changed(`${done} of ${subjectIds.length} objects thought through.`);
    }
  };
  await Promise.all(Array.from({ length: pool }, worker));
  s.changed(
    `Derived ${tally.promises} promise(s) across ${subjectIds.length} subject(s).` +
      (tally.questions ? ` ${tally.questions} question(s) need you.` : ""),
  );
}
