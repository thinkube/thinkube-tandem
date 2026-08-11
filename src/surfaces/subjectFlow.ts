/**
 * Grounding a subject: the whole subject at once, under every rule in
 * force, so one round sees everything that must become true of it and
 * produces one coherent set of promises. Each promise names the claim it
 * makes true — the link that scopes every later re-derivation and makes a
 * promise serving nothing visible as scope creep.
 */
import { Change, Space } from "../core/schema";
import { completeCut, runDerivationPipeline } from "../derive/pipeline";
import type { Knowledge } from "../derive/knowledge";
import type { TandemSession } from "./session";

/** The claims of one subject, in the order the prompt will number them. */
function claimsOf(space: Space, subjectId: string): { id: string; text: string; why?: string }[] {
  return (space.claims ?? [])
    .filter((c) => c.subjectId === subjectId)
    .map((c) => ({ id: c.id, text: c.text, ...(c.why ? { why: c.why } : {}) }));
}

/** One subject's grounding, appended to the PRESENT space. */
async function groundSubject(
  s: TandemSession,
  subjectId: string,
  k: Knowledge,
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
      knowledge: k,
      decisions: s.decisionsInForce(),
      claims,
      digestStore: s.digests(),
      // The gaps and the ripples are looked for ONCE, over the whole cut,
      // after every subject has been ground.
      skipCompleteness: true,
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
  // The one line above the subjects counts subjects finished, because
  // that is the only progress the whole batch shares — every subject is
  // at its own stage, and each says so on its own row.
  const aggregate = (done: number): void => {
    if (subjectIds.length > 1)
      s.activity = {
        label: `thinking about ${subjectIds.length} subjects, each at its own stage`,
        current: done,
        total: subjectIds.length,
      };
  };
  aggregate(0);
  s.changed(
    `Thinking about ${pool} subject${pool === 1 ? "" : "s"}` +
      (subjectIds.length > pool ? `; the other ${subjectIds.length - pool} wait their turn` : "") +
      ".",
  );
  // What is known, built once and carried into every step below: the
  // map from the code itself, the reading on top of it, and the decisions
  // in force. No graph, no derivation — this refuses rather than deriving
  // from a guess about a repository it never read.
  const k = await s.knowledge();

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
      const t = await groundSubject(s, subjectIds[i], k);
      tally.promises += t.promises;
      tally.questions += t.questions;
      s.clear(subjectIds[i]);
      // Written as it arrives. Thinking is the expensive part, and a
      // reload or a crash midway through must not throw away objects that
      // were already paid for.
      done++;
      aggregate(done);
      s.changed(`${done} of ${subjectIds.length} subjects thought through.`);
    }
  };
  await Promise.all(Array.from({ length: pool }, worker));

  // One pass over everything, now that every subject exists: what the set
  // still misses, and the code around it that must move too.
  s.activity = { label: "looking for what is still missing", current: 0, total: 1 };
  s.deps.onChanged?.();
  const claims = (s.space.claims ?? []).filter((c) =>
    subjectIds.includes(c.subjectId),
  );
  // The reading of the repository that grounding already paid for. This
  // round is the one that SEARCHES — it greps for every touched symbol
  // and reads what the hits demand — and it was doing it cold, from
  // nothing, while a whole reading of the same code sat in the store.
  // What moves when these files move, asked of the graph before the round
  // rather than grepped for by it. Every promise's touchpoints, deduped.
  const touched = [
    ...new Set(
      s.space.nodes
        .filter((n) => n.servesClaim && claims.some((c) => c.id === n.servesClaim))
        .flatMap((n) => (n.grounding?.touchpoints ?? []).map((t) => t.path)),
    ),
  ];
  const affected = (await Promise.all(touched.slice(0, 40).map((p) => k.affected(p))))
    .filter(Boolean)
    .join("\n");
  const gaps = await (s.deps.completeCut ?? completeCut)(s.deps.round, {
    digest: k.digest,
    ...(affected ? { affected } : {}),
    decisions: s.decisionsInForce(),
    claims,
    subjects: (s.space.subjects ?? []).filter((x) => subjectIds.includes(x.id)),
    changes: s.space.nodes.filter((n) => n.servesClaim && claims.some((c) => c.id === n.servesClaim)),
    mintNodeId: (n) => `node-${s.author}-gap-${n}`,
    nextIndex: 1,
  });
  if (gaps.length) {
    s.space = { ...s.space, nodes: [...s.space.nodes, ...gaps] };
    tally.promises += gaps.length;
  }
  s.activity = undefined;
  s.changed(
    `Derived ${tally.promises} promise(s) across ${subjectIds.length} subject(s).` +
      (tally.questions ? ` ${tally.questions} question(s) need you.` : ""),
  );
}
