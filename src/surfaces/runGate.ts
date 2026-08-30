/**
 * The two gates and the run between them, host side: signing mints the
 * TEP (the click IS the approval) and starts the build; the build
 * dispatches one batch per repository; accepting merges the delivery on
 * the forge. All state lands on the session's PRESENT space.
 */
import { signCut, acceptDelivery, SIGNATURE_RULE } from "../gates/sign";
import { tepContentHash } from "../gates/approval";
import { planScopes, refuseAnchorless } from "../dispatch/scopes";
import { dispatchScopePlan } from "../dispatch/scopeRun";
import { dropTestHomeOnlyNeeds } from "../dispatch/needs";
import { DispatchOutcome } from "../run/dispatch";
import { RunState, silentVerdict } from "../run/state";
import { saveRun, stopWasRequested } from "../run/record";
import { appendDefect } from "../engine/defectLog";
import { acceptOrder } from "../engine/acceptOrder";
import type { TandemSession } from "./session";
import * as path from "node:path";
import { downstreamOf } from "../run/survey";
import { validateComponentsAfterAccept, watchGitopsAfterAccept } from "../run/harvest";
import { factsOf } from "../run/facts";

/** A gesture's verdict: it succeeded, or it refused and says why. The two
 *  cases are separate so a caller reading `reason` after `ok` is false gets
 *  a string, never a possibly-absent one. */
export type GestureResult = { ok: true } | { ok: false; reason: string };

/**
 * Signed work that never delivered, if there is any.
 *
 * Only an ACCEPTED delivery ends a cut. A delivery that was withheld
 * delivered nothing; one that is open and undecided — or that cannot be
 * accepted, because a check or a review is red — is not the end of the work
 * either. In all three the signed work is still there to run, and the way
 * back in must stay reachable.
 */
export function unrunCutOf(space: TandemSession["space"]): { id: string; tepId?: string } | undefined {
  const delivered = new Set(space.deliveries.filter((d) => d.acceptedAt).map((d) => d.cutId));
  const c = [...space.cuts].reverse().find((x) => x.signature && !x.withdrawnAt && !delivered.has(x.id));
  return c ? { id: c.id, ...(c.tepId ? { tepId: c.tepId } : {}) } : undefined;
}

/**
 * Record why documentation is not needed for the cut about to be signed.
 * The reason is trimmed and kept on the session until signCutGesture mints
 * the cut and puts it there. A reason that is empty or only whitespace says
 * nothing, so it is refused and nothing is recorded — otherwise the
 * documentation rule could be waved through with a blank field.
 */
export function exemptDocsGesture(s: TandemSession, reason: string): GestureResult {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, reason: "a documentation exemption needs a reason" };
  s.docsExemptionReason = trimmed;
  s.changed("Documentation exemption recorded — it travels onto the cut you sign.");
  return { ok: true };
}

export function signCutGesture(s: TandemSession): GestureResult {
    const reason = s.docsExemptionReason;
    const cut = {
      id: `cut-${s.author}-${s.space.cuts.length + 1}`,
      changeIds: [...s.cutNodeIds],
      ...(reason ? { docsExemption: { reason, at: s.deps.now() } } : {}),
    };
    const r = signCut(s.space, cut, s.deps.now(), s.author, s.deps.nextTepNumber?.());
    if (!r.ok) return r;
    s.space = { ...s.space, cuts: [...s.space.cuts, r.cut] };
    // The human's click IS the mint (this message only arrives from the
    // panel): a content-bound token in the machine-local store — the same
    // no-expiry, edit-re-arms discipline the engine's gates verify.
    s.mintTepApproval(r.cut.tepId!, tepContentHash(s.space, r.cut));
    s.cutNodeIds.clear();
    s.docsExemptionReason = undefined;
    s.changed(`${r.cut.tepId} minted — the run is starting.`);
    void executeRun(s, r.cut.id);
    return { ok: true };
  }

export async function executeRun(
  s: TandemSession,
  cutId: string,
  opts: { fresh?: boolean } = {},
): Promise<DispatchOutcome | undefined> {
    const cut = s.space.cuts.find((c) => c.id === cutId);
    if (!cut || s.running) return undefined;
    const approval = cut.tepId ? s.tepApproval(cut.tepId) : { approved: false, reason: "unsigned" };
    // An approval binds the CONTENT the person approved. When the machine
    // changes what a signature covers, that content moves without anybody
    // touching the work, and the token mismatches for a reason the person
    // did not cause and cannot see. The signature already has the rule that
    // says so; the token has no room for one, so the cut's own rule answers
    // for it. Older rule, content-mismatch: attributable to the change, and
    // the run proceeds saying the drift was not checked. Same rule: a real
    // mismatch, and the refusal stands.
    const staleRule = (cut.signature?.rule ?? 1) !== SIGNATURE_RULE;
    if (!approval.approved && !(staleRule && approval.reason === "content-mismatch")) {
      s.runNote = `The build could not start: ${approval.reason} — re-sign the cut.`;
      s.changed(s.runNote);
      return undefined;
    }
    if (!approval.approved)
      s.changed(
        `${cut.tepId} was approved before the machine changed what a signature covers — running it, with the drift since then unchecked.`,
      );
    // A project space resolves a forge PER REPOSITORY BATCH; only a
    // plain repository session needs the anchor forge.
    if (!s.deps.forge && !s.deps.resolveScope) {
      s.runNote =
        "The build could not start: no forge is reachable for this repository — set thinkubeTandem.giteaToken (or use a repository whose remote carries its credential). The cut stays signed, undelivered.";
      s.changed(s.runNote);
      return undefined;
    }
    // The old note dies the moment a new press starts — a corpse is never news.
    s.runNote = undefined;
    s.running = true;
    s.driving = true;
    s.changed("Starting — refreshing the branch…");
    // The run is written down AS IT HAPPENS, not only when it is over.
    // A record kept until the end is a record nobody can read while they
    // need it — the surface holds the only copy, so a crash takes the
    // whole account with it, and nothing outside the window can say what
    // a worker is doing. Throttled: a run reports constantly, and this is
    // a file.
    let lastWrite = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    // How this run ended, once it has. Written with every save, so a
    // surface that did not start the run still learns what happened to it
    // — a refusal, a withholding, a stop — instead of watching a record
    // that says "running" forever.
    const startedAt = s.deps.now();
    let endedAs: "refused" | "withheld" | "delivered" | "halted" | undefined;
    const keep = (): void => {
      if (!s.runState) return;
      saveRun(
        s.deps.storeDir,
        {
          cutId,
          tepId: cut.tepId,
          at: s.deps.now(),
          owner: { pid: process.pid, at: startedAt },
          state: s.running ? "running" : (endedAs ?? "halted"),
          ...(s.runNote ? { note: s.runNote } : {}),
        },
        s.runState,
      );
      lastWrite = Date.now();
    };
    /** The run ends, and says so where anyone can read it. */
    const settle = (state: NonNullable<typeof endedAs>, note?: string): void => {
      s.running = false;
      endedAs = state;
      s.runNote = note;
      keep();
      s.changed(note);
    };
    let lastBeat = Date.now();
    s.runState = new RunState(() => {
      lastBeat = Date.now();
      s.deps.onChanged?.();
      if (Date.now() - lastWrite >= 2000) keep();
      else if (!pending)
        pending = setTimeout(() => {
          pending = undefined;
          keep();
        }, 2000);
    });
    // The heartbeat: every exec is bounded (makeExec), so the longest
    // legitimate silence is the suite's own bound — beyond it, the run
    // declares itself dead at its last named step instead of going quiet.
    const pulse = setInterval(() => {
      const st = s.runState;
      if (!st) return;
      // A stop asked for by somebody who is not driving. Stopping used to
      // be a method call on an object in one process's memory, so the
      // person could only stop a run their own window had started — a run
      // driven from anywhere else could not be reached at all. The request
      // is written where the owner reads it, and the owner ends itself.
      if (stopWasRequested(s.deps.storeDir, cutId, startedAt)) {
        st.log("⛔ stopped: a stop was asked for from outside this run");
        st.halt();
        settle("halted", "The build was stopped.");
        clearInterval(pulse);
        return;
      }
      const verdict = silentVerdict({
        running: s.running,
        lastBeatMs: lastBeat,
        nowMs: Date.now(),
        limitMs: 25 * 60 * 1000,
        lastLine: st.logs.at(-1),
        busyUnits: [...st.units.values()].filter((u) => u.state === "running").map((u) => ({ id: u.id, text: u.activity?.text })),
      });
      if (!verdict) return;
      st.log(`⛔ ${verdict}`);
      appendDefect(s.deps.storeDir, { spec: cut.tepId ?? cutId, activity: "run", trigger: "silent-stall", impact: "run stopped by its heartbeat", detail: verdict });
      st.halt();
      settle("halted", `The build stopped: ${verdict}`);
    }, 60 * 1000);
    s.changed(`Building ${cut.tepId ?? cutId}…`);
    try {
      // The repository reading rides into every worker's brief. Cached
      // under the repo stamp, so after a derivation this costs nothing;
      // a run must never refuse over brief enrichment, hence fail-soft.
      const known = await s.knowledge().catch(() => undefined);
      const digest = known?.digest;
      // A promise-level need that exists only because a test home imports
      // another promise's code belongs to the maintain slice, not the plan:
      // dropped before planning, so it forces no ring into one slice.
      if (known) {
        const members = s.space.nodes.filter((n) => cut.changeIds.includes(n.id)).map((n) => ({ ...n, needs: [...n.needs] }));
        const dropped = await dropTestHomeOnlyNeeds(members, (p) => known.affected(p)).catch(() => []);
        if (dropped.length) {
          const byId = new Map(members.map((n) => [n.id, n]));
          s.space = { ...s.space, nodes: s.space.nodes.map((n) => byId.get(n.id) ?? n) };
          s.runState?.log(`plan: ${dropped.length} need(s) explained only by a test-home import moved to the maintain slice`);
        }
      }
      const plan = planScopes(s.space, cut);
      if (!plan.ok) {
        settle("refused", `The build could not start: ${plan.reason}.`);
        s.changed(s.runNote);
        return undefined;
      }
      const anchorRefusal = s.deps.anchorless ? refuseAnchorless(plan, s.space) : undefined;
      if (anchorRefusal) {
        settle("refused", anchorRefusal);
        s.changed(anchorRefusal);
        return undefined;
      }
      // The check-setup facts: the machine's own reading of the repo,
      // unless the human explicitly overrode the build step in settings.
      const prepare = s.deps.prepareCommand || known?.prepare || undefined;
      const provision = known?.provision || undefined;
      const runOne = known?.runOne || undefined;
      // The product build — proved at the door, red at the gate — from the
      // repository's own facts first, the reading second.
      const build = factsOf(s.deps.round.repoRoot)?.build || known?.build || undefined;
      const suiteReds = known?.suiteReds;
      const rememberSuiteReds = known?.rememberSuiteReds;
      const resetup = known?.resetup;
      const proveSetup = known?.proveSetup;
      // The graph's importer listing: the run reads it to order each slice's
      // test-home work after the production code those tests import.
      const affected = known ? (p: string) => known.affected(p) : undefined;
      let last;
      last = await dispatchScopePlan({
        plan,
        cut,
        space: () => s.space,
        deps: opts.fresh ? { ...s.deps, freshStart: true } : s.deps,
        runState: s.runState!,
        spaceName: path.basename(s.deps.storeDir),
        ...(digest ? { digest } : {}),
        ...(prepare ? { prepare } : {}),
        ...(build ? { build } : {}),
        ...(provision ? { provision } : {}),
        ...(runOne ? { runOne } : {}),
        ...(suiteReds ? { suiteReds } : {}),
        ...(rememberSuiteReds ? { rememberSuiteReds } : {}),
        ...(resetup ? { resetup } : {}),
        ...(proveSetup ? { proveSetup } : {}),
        ...(affected ? { affected } : {}),
        onDelivery: (delivery, note) => {
          // One delivery per cut, replaced by the newest run. A cut run four
          // times used to leave four rows on the page, three of them stale
          // and none of them marked as such, and a person had to read the
          // branch names to find which one was now true.
          const kept = s.space.deliveries.filter(
            (d) => d.cutId !== delivery.cutId || d.acceptedAt || d.id === delivery.id,
          );
          const at = kept.findIndex((d) => d.id === delivery.id);
          s.space = {
            ...s.space,
            deliveries: at >= 0 ? kept.map((d, i) => (i === at ? delivery : d)) : [...kept, delivery],
          };
          s.changed(note);
        },
        // The check's forwarding address: each criterion records where its
        // standing proof now lives in the repository's own suite.
        onAnchors: (anchors) => {
          const byId = new Map(anchors.map((a) => [a.criterionId, a]));
          s.space = {
            ...s.space,
            nodes: s.space.nodes.map((n) =>
              n.acceptance.some((a) => byId.has(a.id))
                ? {
                    ...n,
                    acceptance: n.acceptance.map((a) => {
                      const hit = byId.get(a.id);
                      return hit
                        ? {
                            ...a,
                            proof: {
                              path: hit.path,
                              ...(hit.test ? { test: hit.test } : {}),
                              stamp: hit.stamp,
                            },
                          }
                        : a;
                    }),
                  }
                : n,
            ),
          };
        },
        changed: (m) => s.changed(m),
      });
      if (last?.delivery?.withheld) settle("withheld", `The delivery was withheld: ${last.delivery.withheld}`);
      else if (last?.refusals.length && !last.delivery)
        settle("refused", `The build stopped: ${last.refusals.join(" · ")}`);
      else if (last?.delivery) settle("delivered", undefined);
      return last;
    } catch (err) {
      // A crash is a stop with a cause — on the run's log, in the ledger,
      // and on the note the human reads; never a silent "nothing delivered".
      const why = err instanceof Error ? (err.stack ?? err.message) : String(err);
      s.runState?.log(`⛔ the run crashed: ${why.split("\n")[0]}`);
      appendDefect(s.deps.storeDir, { spec: cut.tepId ?? cutId, activity: "run", trigger: "crash", impact: "run stopped", detail: why.slice(0, 1500) });
      s.runNote = `The build stopped unexpectedly: ${why.split("\n")[0].slice(0, 300)}`;
      s.changed(s.runNote);
      return undefined;
    } finally {
      clearInterval(pulse);
      s.running = false;
      s.driving = false;
      if (pending) clearTimeout(pending);
      // And once more at the end, so the last thing that happened is in
      // the record whatever the throttle was doing when it happened.
      keep();
    }
  }

/**
 * The one notice for signed work that has not delivered: what it says, and
 * which ways back in ride with it. Every page that can show this fact reads
 * it from here instead of wording it again — moving between pages never
 * re-tells you the same thing in different words.
 *
 * Nothing while a run is in flight (there is nothing idle to report), and
 * nothing when there is no signed, undelivered work at all. A refusal note
 * on the session becomes this notice's sentence verbatim — it is not a
 * second notice beside it.
 */
export function signedIdleNotice(view: {
  unrun?: { id: string; tepId?: string };
  running: boolean;
  runNote?: string;
}): { heading: string; sentence: string; canRerun: boolean; canThinkAgain: boolean } | undefined {
  if (view.running || !view.unrun) return undefined;
  return {
    heading: view.runNote ? "Nothing is running." : "This work is signed and has not run.",
    sentence:
      view.runNote ??
      `${view.unrun.tepId ?? "This work"} is signed and nothing was delivered from it. Its last run ended without a delivery — if the window reloaded, the run ended with it.`,
    canRerun: true,
    canThinkAgain: true,
  };
}

/**
 * Refuse a delivery: it ends nothing, and the way back in stays open.
 *
 * The work stays on its branch — nothing is thrown away — the delivery
 * keeps its proofs as the record of what was tried, and the cut returns to
 * signed, so the same signed promises can run again against what was
 * learned by refusing.
 */
export function rejectDeliveryGesture(s: TandemSession, deliveryId: string, at: string): { ok: boolean; reason?: string } {
  const d = s.space.deliveries.find((x) => x.id === deliveryId);
  if (!d) return { ok: false, reason: `no delivery '${deliveryId}'` };
  if (d.acceptedAt) return { ok: false, reason: "it was already accepted" };
  s.space = {
    ...s.space,
    deliveries: s.space.deliveries.map((x) => (x.id === deliveryId ? { ...x, rejectedAt: at } : x)),
  };
  s.changed("The delivery was refused — the work stays on its branch, and the signed promises can run again.");
  return { ok: true };
}

export async function acceptDeliveryGesture(s: TandemSession, deliveryId: string): Promise<{ ok: boolean; reason?: string }> {
    const d = s.space.deliveries.find((x) => x.id === deliveryId);
    if (!d) return { ok: false, reason: `no delivery '${deliveryId}'` };
    const r = acceptDelivery(d, s.deps.now(), s.deps.docsGateMode ?? "blocking", s.space.deliveries);
    if (!r.ok) return r;
    const cut = s.space.cuts.find((c) => c.id === d.cutId);
    const tepId = cut?.tepId;
    try {
      await acceptOrder({
        merge: async () => {
          if (s.deps.forge && d.url) await s.deps.forge.merge(d.url);
          return { merged: !!(s.deps.forge && d.url) };
        },
        stamp: async () => {
          s.space = {
            ...s.space,
            deliveries: s.space.deliveries.map((x) =>
              x.id === deliveryId ? r.delivery : x,
            ),
          };
        },
        retire: async () => {
          if (tepId && s.deps.retire) await s.deps.retire(tepId);
        },
      });
    } catch (err) {
      return {
        ok: false,
        reason: `the forge refused the merge: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    s.changed("Accepted and merged.");
    // The merge's push fired the platform pipeline for a gitops app; the
    // promises marked settled-elsewhere are answered THERE. Watch it and
    // stamp the answers home — the person sees promises close, not a
    // delivery frozen at "pending" forever. Started, never awaited: the
    // accept returns; the watch reports through the space.
    const gitRoot = s.deps.scope?.gitRoot ?? s.deps.round.repoRoot;
    const down = downstreamOf(gitRoot);
    // A playbook component proves itself on the live cluster, and Tandem
    // can run that itself — the one downstream it executes rather than
    // watches. Started, never awaited, like the pipeline watch.
    if (down === "ansible" || down === "ansible-component")
      void validateComponentsAfterAccept({
        repoRoot: gitRoot,
        landed: [
          ...new Set(
            s.space.nodes
              .filter((n) => (cut?.changeIds ?? []).includes(n.id))
              .flatMap((n) => (n.grounding?.touchpoints ?? []).map((t) => t.path)),
          ),
        ],
        delivery: r.delivery,
        update: (d, note) => {
          s.space = { ...s.space, deliveries: s.space.deliveries.map((x) => (x.id === d.id ? d : x)) };
          s.persist();
          s.changed(note);
        },
        log: (l) => s.changed(l),
      });
    if (down === "gitops-app")
      void watchGitopsAfterAccept({
        gitRoot,
        app: path.basename(gitRoot),
        delivery: r.delivery,
        acceptedAt: s.deps.now(),
        update: (d, note) => {
          s.space = { ...s.space, deliveries: s.space.deliveries.map((x) => (x.id === d.id ? d : x)) };
          s.persist();
          s.changed(note);
        },
        log: (l) => s.changed(l),
      });
    return { ok: true };
  }
