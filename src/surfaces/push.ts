/**
 * What the surface is shown: the whole state of a space, rebuilt after
 * every act. The webview holds nothing of its own beyond selection, so
 * this is the single place that decides what a person can see — and,
 * through the phase, what they may press.
 */
import { TandemSession } from "./session";
import { promisesOfSpec } from "../derive/specs";
import { signedIds } from "../core/cutClosure";
import { allowedNow, phaseOf } from "./phase";
import { readyToBuild } from "./buildFlow";
import { acceptDelivery } from "../gates/sign";
import { docsDuty } from "../core/docsDuty";
import { promiseLabelOf } from "./runPromiseLabel";
import { saidPlainly } from "../gates/render";
import { signedIdleNotice } from "./runGate";

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
): { verdict: "green" | "red" | "unjudged"; said?: string; tep?: string; accepted: boolean } | undefined {
  const ds = session.space.deliveries;
  for (let i = ds.length - 1; i >= 0; i--) {
    const proof = ds[i].proofs.find((p) => p.criterionId === criterionId);
    if (!proof || proof.verdict === "pending") continue;
    const tep = session.space.cuts.find((c) => c.id === ds[i].cutId)?.tepId;
    const verdict = proof.verdict === "green" ? "green" : proof.verdict === "unjudged" ? "unjudged" : "red";
    const said = verdict === "green" ? "" : saidPlainly(proof);
    return {
      verdict,
      ...(said ? { said } : {}),
      ...(tep ? { tep } : {}),
      accepted: !!ds[i].acceptedAt,
    };
  }
  return undefined;
}

export function spacePush(session: TandemSession, message?: string): unknown {
  const byId = new Map(session.space.nodes.map((n) => [n.id, n]));
  // Read once, held for every delivery this push renders — not once per
  // delivery and not skipped for a push that has any.
  const surfaceText = session.readBuiltSurfaceOnce();
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
    repoName: session.repoName,
    spaceName: session.spaceName,
    activity: session.activity,
    pendingCheck: session.pendingCheck,
    runNote: session.runNote,
    // Signed work that never delivered: the run can be started again,
    // and the surface is the only place that can say so.
    unrun: session.unrunCut(),
    // The one notice for that fact — its heading, its sentence, and the
    // ways back in — worked out once here so no page words it again.
    signedIdle: signedIdleNotice({
      unrun: session.unrunCut(),
      running: session.running,
      runNote: session.runNote,
    }),
    grounding: session.groundingView(),
    signedTeps: session.space.cuts.filter((c) => c.signature).length,
    runLog: session.logView(),
    // The chart names each worker by the slice it builds, in the words the
    // human named it — the worker id stays available underneath. `runId`
    // rides along in the spread: the same id that will land on the
    // delivery this run mints, so what is watched can be matched against
    // what is reported.
    run: (() => {
      const v = session.runState?.view();
      if (!v) return undefined;
      return {
        ...v,
        units: v.units.map((u) => {
          const title = session.units.find((x) => x.id === u.slice)?.abstract?.title;
          const promiseLabel = promiseLabelOf({
            nodes: session.space.nodes,
            units: session.units,
            slice: u.slice,
            criterionIds: session.runState?.plan?.find((s) => s.handle === u.slice)?.criterionIds ?? [],
          });
          return {
            ...u,
            ...(title ? { sliceTitle: title } : {}),
            ...(promiseLabel ? { promiseLabel } : {}),
          };
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
            // What the page marks inside your sentence: the words this
            // claim was read from, and the words that stand for the subject
            // there. Without them the page can only search for the
            // subject's NAME, which is one sentence's wording out of five.
            ...(c.quote ? { quote: c.quote } : {}),
            ...(c.mention !== undefined ? { mention: c.mention } : {}),
            promises: promises.map((n) => ({
              id: n.id,
              text: n.sentence,
              file: (n.grounding?.touchpoints ?? []).map((t) => t.path).join(", "),
              // Verification lives on the claim card: what proves the
              // check, the newest verdict, and whether the world moved
              // since — independent of how many iterations built it.
              checks: n.acceptance.map((a) => ({
                id: a.id,
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
      session.chosenSpec(),
    ),
    /** Promises attached to no claim — the machine could not place them. */
    orphans: session.space.nodes
      .filter((n) => !n.servesClaim)
      .map((n) => ({ id: n.id, text: n.sentence })),
    modelFailure: session.modelFailure
      ? { reason: session.modelFailure.reason, sentences: session.modelFailure.texts.length }
      : undefined,
    draft: session.space.draft ?? "",
    ...(session.buildRefusal ? { buildRefusal: session.buildRefusal } : {}),
    ...(session.acceptRefusal ? { acceptRefusal: session.acceptRefusal } : {}),
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
    // The one rule's verdict for the cut about to be signed — the rail
    // states this rather than working it out again from the promises.
    documentation: docsDuty(session.space, {
      id: "pending",
      changeIds: [...session.cutNodeIds],
      ...(session.docsExemptionReason
        ? { docsExemption: { reason: session.docsExemptionReason, at: session.deps.now() } }
        : {}),
    }),
    // The sets worth delivering on their own, with what each covers — so a
    // person choosing one can see its size before they build it.
    specs: (session.space.specs ?? []).map((sp) => {
      const ids = promisesOfSpec(session.space, sp);
      const signed = signedIds(session.space.cuts);
      const byId = new Map(session.space.nodes.map((n) => [n.id, n]));
      return {
        id: sp.id,
        name: sp.name,
        subjects: sp.subjectIds.length,
        // Which of YOUR sentences this set carries, by their own numbers.
        // A count told you a set had two subjects and nothing told you
        // which, so a wrong grouping was invisible until it was built.
        asks: [
          ...new Set(
            (session.space.subjects ?? [])
              .filter((sub) => sp.subjectIds.includes(sub.id))
              .flatMap((sub) => sub.from)
              .map((id) => session.space.asks.findIndex((a) => a.id === id) + 1)
              .filter((n) => n > 0),
          ),
        ].sort((a, b) => a - b),
        promises: ids.length,
        chosen: session.cutSpecId === sp.id,
        built: ids.length > 0 && ids.every((id) => signed.has(id)),
        ...((): { fate?: "accepted" | "delivered" | "building" | "not run" } => {
          const cut = session.space.cuts.find((c) => c.signature && c.specId === sp.id);
          if (!cut) return {};
          const delivery = session.space.deliveries.find((d) => d.cutId === cut.id);
          if (delivery?.acceptedAt) return { fate: "accepted" };
          if (delivery) return { fate: "delivered" };
          if (session.running && session.cutSpecId === sp.id) return { fate: "building" };
          return { fate: "not run" };
        })(),
        repos: [
          ...new Set(
            ids.flatMap((id) =>
              (byId.get(id)?.grounding?.touchpoints ?? []).map((t) => t.scope || session.repoName),
            ),
          ),
        ],
      };
    }),
    deliveries: session.space.deliveries.map((d) => ({
      id: d.id,
      page: session.deliveryPage(d.id, surfaceText) ?? "",
      accepted: !!d.acceptedAt,
      // Whether it COULD be accepted, asked of the same gate that would
      // refuse it. A surface that offers a press the machine will refuse
      // is telling the human this work is ready to go into the project.
      ...(() => {
        if (d.acceptedAt) return {};
        const r = acceptDelivery(d, session.deps.now(), session.deps.docsGateMode ?? "blocking");
        return r.ok ? {} : { blocked: r.reason };
      })(),
      ...(d.url ? { url: d.url } : {}),
      ...(d.observations?.length ? { observations: d.observations } : {}),
      // Promises answered somewhere this run cannot reach — the pipeline
      // the merge fired, the cluster, a person's own machine. Shown with
      // WHERE the answer comes from, so a delivery that is not finished
      // says which part of it is still out, instead of looking incomplete.
      ...(() => {
        const pending = d.proofs
          .filter((p) => p.verdict === "pending" && p.settledBy)
          .map((p) => ({
            ...(p.criterionId ? { criterionId: p.criterionId } : {}),
            text: p.label,
            settledBy: p.settledBy!,
            ...(p.ref ? { ref: p.ref } : {}),
          }));
        return pending.length ? { pending } : {};
      })(),
      ...(d.undelivered?.length ? { undelivered: d.undelivered } : {}),
      ...((): { tep?: string } => {
        const cut = session.space.cuts.find((c) => c.id === d.cutId);
        return cut?.tepId ? { tep: cut.tepId } : {};
      })(),
      ...(d.withheld ? { withheld: d.withheld } : {}),
      proofs: d.proofs
        .filter((p) => p.criterionId && p.verdict !== "pending")
        .map((p) => {
          const verdict = p.verdict === "green" ? ("green" as const) : p.verdict === "unjudged" ? ("unjudged" as const) : ("red" as const);
          const said = verdict === "green" ? "" : saidPlainly(p);
          return { criterionId: p.criterionId!, verdict, ...(said ? { said } : {}) };
        }),
      // The way back in, on every delivery that is not accepted: withheld,
      // blocked by a red check, or simply still waiting for your decision.
      ...(d.acceptedAt ? {} : { rerun: session.unrunCut() }),
    })),
    ...(message ? { message } : {}),
  };
}

