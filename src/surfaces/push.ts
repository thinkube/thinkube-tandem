/**
 * What the surface is shown: the whole state of a space, rebuilt after
 * every act. The webview holds nothing of its own beyond selection, so
 * this is the single place that decides what a person can see — and,
 * through the phase, what they may press.
 */
import { TandemSession } from "./session";
import { allowedNow, phaseOf } from "./phase";
import { readyToBuild } from "./buildFlow";
import { acceptDelivery } from "../gates/sign";

const TITLE_CLIP = 64;

/**
 * How far this ask's work actually got: approved, delivered, or accepted
 * into the project. Signing is the first of the three and the only one
 * the human performs — the other two are things the machine did or did
 * not manage.
 */
function boundState(
  session: TandemSession,
  askId: string,
): { tep?: string; stage: "signed" | "delivered" | "accepted" } {
  const mine = new Set(
    session.space.nodes.filter((n) => n.serves.includes(askId)).map((n) => n.id),
  );
  const cut = session.space.cuts.find(
    (c) => c.signature && c.changeIds.some((id) => mine.has(id)),
  );
  const delivery = cut
    ? session.space.deliveries.find((d) => d.cutId === cut.id)
    : undefined;
  return {
    ...(cut?.tepId ? { tep: cut.tepId } : {}),
    stage: !delivery ? "signed" : delivery.acceptedAt ? "accepted" : "delivered",
  };
}

function shorten(text: string): string {
  return text.length > TITLE_CLIP ? `${text.slice(0, TITLE_CLIP - 1).trimEnd()}…` : text;
}
function shortenWords(text: string, words: number): string {
  const parts = text.split(/\s+/);
  return parts.slice(0, words).join(" ") + (parts.length > words ? "…" : "");
}

/**
 * What was assumed in one sentence's name. An assumption belongs under the
 * sentence it could not be decided from — that is where a person looks for
 * it when something grates, and it is the sentence they would reframe.
 */
function assumptionsFor(
  session: TandemSession,
  askId: string,
): { question: string; answer: string; clause?: string; assumed: boolean }[] {
  const claims = session.space.claims ?? [];
  const mine = new Set(
    claims.filter((c) => c.fromAsk === askId).map((c) => c.subjectId),
  );
  return session.space.questions
    .filter((q) => q.askId === askId || mine.has(q.askId))
    .map((q) => ({
      // An assumption is an ANSWER, and an answer without its question is
      // unreadable: "No — the waiver is bound by the signature" says
      // nothing about what was asked. Both travel together or neither does.
      question: q.text.replace(/^Uncovered: "[^"]*" — /, ""),
      answer: q.decided?.text ?? q.recommendation ?? q.text,
      ...(q.clause ? { clause: q.clause } : {}),
      assumed: !q.decided,
    }));
}

/** The newest word on a check, read from the deliveries: its verdict,
 *  the TEP that produced it, and whether the human accepted that work. */
function latestVerdictOf(
  session: TandemSession,
  criterionId: string,
): { verdict: "green" | "red"; tep?: string; accepted: boolean } | undefined {
  const ds = session.space.deliveries;
  for (let i = ds.length - 1; i >= 0; i--) {
    const proof = ds[i].proofs.find((p) => p.criterionId === criterionId);
    if (!proof || proof.verdict === "pending") continue;
    const tep = session.space.cuts.find((c) => c.id === ds[i].cutId)?.tepId;
    return {
      verdict: proof.verdict === "green" ? "green" : "red",
      ...(tep ? { tep } : {}),
      accepted: !!ds[i].acceptedAt,
    };
  }
  return undefined;
}

export function spacePush(session: TandemSession, message?: string): unknown {
  const byId = new Map(session.space.nodes.map((n) => [n.id, n]));
  return {
    kind: "space",
    running: session.running,
    phase: phaseOf(session),
    allowed: allowedNow(phaseOf(session)),
    // A space derived before the model existed cannot be read as subjects
    // and claims. It stays readable; new work starts in a new space.
    legacy:
      session.space.nodes.length > 0 && !(session.space.subjects ?? []).length
        ? "This space was thought through before subjects and claims existed. Its promises are kept and readable, but new work starts in a new thinking space — paste your asks there."
        : undefined,
    // The exemption typed before signing, so the rail can say documentation
    // is excused and print the reason back. Absent entirely when the session
    // holds none — a surface never shows an empty excuse.
    ...(session.space.pendingDocsExemption
      ? { docsExemption: { reason: session.space.pendingDocsExemption.reason } }
      : {}),
    repoName: session.repoName,
    activity: session.activity,
    pendingCheck: session.pendingCheck,
    runNote: session.runNote,
    // Signed work that never delivered: the run can be started again,
    // and the surface is the only place that can say so.
    unrun: session.unrunCut(),
    grounding: session.groundingView(),
    signedTeps: session.space.cuts.filter((c) => c.signature).length,
    runLog: session.logView(),
    // The chart names each worker by the slice it builds, in the words the
    // human named it — the worker id stays available underneath.
    run: (() => {
      const v = session.runState?.view();
      if (!v) return undefined;
      return {
        ...v,
        units: v.units.map((u) => {
          const title = session.units.find((x) => x.id === u.slice)?.abstract?.title;
          return title ? { ...u, sliceTitle: title } : u;
        }),
      };
    })(),
    // A question belongs to an ask, and the ask has cards on the map: both
    // ride along so a recommendation is never a floating sentence.
    questions: session.space.questions
      .filter((q) => !q.decided)
      .map((q) => {
        const idx = session.space.asks.findIndex((a) => a.id === q.askId);
        const ask = idx >= 0 ? session.space.asks[idx] : undefined;
        const serving = new Set(
          session.space.nodes.filter((n) => n.serves.includes(q.askId)).map((n) => n.id),
        );
        return {
          id: q.id,
          text: q.text,
          recommendation: q.recommendation,
          ...(ask ? { askLabel: `ask ${idx + 1} — ${shortenWords(ask.text, 7)}` } : {}),
          cards: session.units
            .filter((u) => u.changeIds.some((id) => serving.has(id)))
            .map((u) => ({
              id: u.id,
              title: u.abstract?.title ?? shorten(byId.get(u.changeIds[0])?.sentence ?? u.id),
            })),
        };
      }),
    decisions: session.space.questions
      .filter((q) => !!q.decided)
      .map((q) => q.decided!.text),
    impacts: (session.space.impacts ?? []).map((im) => ({
      id: im.id,
      decision: im.decision,
      askText: session.space.asks.find((a) => a.id === im.askId)?.text ?? im.askId,
      affected: session.space.nodes.filter((n) => n.serves.includes(im.askId)).length,
    })),
    // Graph 1 — the model, in the human's words. Graph 2 — the promises,
    // each under the claim it makes true.
    subjects: (session.space.subjects ?? []).map((s) => {
      const claims = (session.space.claims ?? []).filter((c) => c.subjectId === s.id);
      const numberOf = (id: string): number =>
        session.space.asks.findIndex((a) => a.id === id) + 1;
      return {
        id: s.id,
        name: s.name,
        // Where it came from, in your numbering — the link that makes the
        // reading readable instead of a second copy of what you wrote.
        from: [...new Set(s.from)]
          .filter((id) => session.space.asks.some((a) => a.id === id))
          .map((id) => ({
            id,
            n: numberOf(id),
            text: session.space.asks.find((a) => a.id === id)!.text,
          })),
        thinking: session.groundingView().find((g) => g.askId === s.id),
        claims: claims.map((c) => {
          const promises = session.space.nodes.filter((n) => n.servesClaim === c.id);
          return {
            id: c.id,
            text: c.text,
            why: c.why,
            fromAsk: session.space.asks.find((a) => a.id === c.fromAsk)?.text ?? "",
            fromAskId: c.fromAsk,
            fromAskN: session.space.asks.findIndex((a) => a.id === c.fromAsk) + 1,
            promises: promises.map((n) => ({
              id: n.id,
              text: n.sentence,
              file: (n.grounding?.touchpoints ?? []).map((t) => t.path).join(", "),
              // Verification lives on the claim card: what proves the
              // check, the newest verdict, and whether the world moved
              // since — independent of how many iterations built it.
              checks: n.acceptance.map((a) => ({
                text: a.text,
                ...(a.kind === "assessment" ? { kind: "assessment" as const } : {}),
                ...(latestVerdictOf(session, a.id) ?? {}),
                ...(a.proof
                  ? { proof: { path: a.proof.path, ...(a.proof.test ? { test: a.proof.test } : {}) } }
                  : {}),
                ...(session.proofDrift.has(a.id) ||
                (a.kind === "assessment" && session.stale.has(n.id))
                  ? { drifted: true }
                  : {}),
              })),
              ...(n.unverified?.length ? { unverified: n.unverified } : {}),
              needs: n.needs,
              inCut: session.cutNodeIds.has(n.id),
              stale: session.stale.has(n.id),
              tep: session.space.cuts.find(
                (cu) => cu.signature && cu.changeIds.includes(n.id),
              )?.tepId,
            })),
          };
        }),
      };
    }),
    // Your sentences: each with what it decided, what it assumed in your
    // name, whether it is still yours to edit, and what editing costs.
    sentences: session.space.asks.map((a) => {
      const price = session.priceOf(a.id);
      return {
        id: a.id,
        text: a.text,
        state: price.state,
        subjects: price.subjects,
        promises: price.promises,
        alsoReads: price.alsoReads,
        ...(a.amends
          ? { amends: session.space.asks.find((x) => x.id === a.amends)?.text ?? "" }
          : {}),
        // What became of this ask, told by what actually happened to it.
        // Signing is approval, not building: the run can refuse the plan
        // and deliver nothing, and saying "built" over work that never
        // dispatched is the machine reporting its own intention as fact.
        // The cut named is the one holding THIS ask's promises — the
        // lookup here once matched any signed cut at all.
        ...(price.state === "bound" ? { bound: boundState(session, a.id) } : {}),
        assumptions: assumptionsFor(session, a.id),
      };
    }),
    /** What thinking about the rest will cost, before it is spent. */
    cost: session.thinkingCost(),
    outOfDate: (() => {
      const stale = session.space.nodes.filter((n) => session.stale.has(n.id));
      const subjects = new Set(
        stale
          .map((n) => (session.space.claims ?? []).find((c) => c.id === n.servesClaim)?.subjectId)
          .filter((id): id is string => !!id),
      );
      return {
        promises: stale.length,
        subjects: subjects.size,
        rounds: subjects.size ? subjects.size * 2 : 0,
      };
    })(),
    /** What can be committed right now — whole components only, and
     *  nothing at all while the machine is still deriving. */
    ready: readyToBuild(
      session.space,
      !!session.activity || session.groundingView().length > 0,
    ),
    /** Promises attached to no claim — the machine could not place them. */
    orphans: session.space.nodes
      .filter((n) => !n.servesClaim)
      .map((n) => ({ id: n.id, text: n.sentence })),
    modelFailure: session.modelFailure
      ? { reason: session.modelFailure.reason, sentences: session.modelFailure.texts.length }
      : undefined,
    draft: session.space.draft ?? "",
    pendingModel: session.pendingModel
      ? {
          subjects: session.pendingModel.subjects,
          texts: session.pendingModel.texts,
          fresh: session.draftRead(),
          missing: session.pendingModel.missing.map(
            (n) => session.pendingModel!.texts[n - 1] ?? `sentence ${n}`,
          ),
        }
      : undefined,
    cutCount: session.cutNodeIds.size,
    deliveries: session.space.deliveries.map((d) => ({
      id: d.id,
      page: session.deliveryPage(d.id) ?? "",
      accepted: !!d.acceptedAt,
      // Whether it COULD be accepted, asked of the same gate that would
      // refuse it. A surface that offers a press the machine will refuse
      // is telling the human this work is ready to go into the project.
      ...(() => {
        if (d.acceptedAt) return {};
        const r = acceptDelivery(
          d,
          session.deps.now(),
          session.deps.docsGateMode ?? "blocking",
          session.space.deliveries,
        );
        return r.ok ? {} : { blocked: r.reason };
      })(),
      ...(d.url ? { url: d.url } : {}),
      ...(d.undelivered?.length ? { undelivered: d.undelivered } : {}),
      ...(d.withheld ? { withheld: d.withheld } : {}),
      // The way back in, on every delivery that is not accepted: withheld,
      // blocked by a red check, or simply still waiting for your decision.
      ...(d.acceptedAt ? {} : { rerun: session.unrunCut() }),
    })),
    ...(message ? { message } : {}),
  };
}

