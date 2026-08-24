/**
 * The two gates and the run between them, host side: signing mints the
 * TEP (the click IS the approval) and starts the build; the build
 * dispatches one batch per repository; accepting merges the delivery on
 * the forge. All state lands on the session's PRESENT space.
 */
import { signCut, acceptDelivery } from "../gates/sign";
import { tepContentHash } from "../gates/approval";
import { planScopes, refuseAnchorless } from "../dispatch/scopes";
import { dispatchScopePlan } from "../dispatch/scopeRun";
import { dropTestHomeOnlyNeeds } from "../dispatch/needs";
import { DispatchOutcome } from "../run/dispatch";
import { RunState, silentVerdict } from "../run/state";
import { saveRun } from "../run/record";
import { appendDefect } from "../engine/defectLog";
import { acceptOrder } from "../engine/acceptOrder";
import type { TandemSession } from "./session";
import { settleDelivery } from "../core/records";
import * as path from "node:path";
import { factsOf } from "../run/facts";

export function signCutGesture(s: TandemSession): { ok: boolean; reason?: string } {
    const cut = {
      id: `cut-${s.author}-${s.space.cuts.length + 1}`,
      changeIds: [...s.cutNodeIds],
    };
    const r = signCut(s.space, cut, s.deps.now(), s.author, s.deps.nextTepNumber?.());
    if (!r.ok) return r;
    s.space = { ...s.space, cuts: [...s.space.cuts, r.cut] };
    // The human's click IS the mint (this message only arrives from the
    // panel): a content-bound token in the machine-local store — the same
    // no-expiry, edit-re-arms discipline the engine's gates verify.
    s.mintTepApproval(r.cut.tepId!, tepContentHash(s.space, r.cut));
    s.cutNodeIds.clear();
    s.changed(`${r.cut.tepId} minted — the run is starting.`);
    void executeRun(s, r.cut.id);
    return { ok: true };
  }

export async function executeRun(s: TandemSession, cutId: string): Promise<DispatchOutcome | undefined> {
    const cut = s.space.cuts.find((c) => c.id === cutId);
    if (!cut || s.running) return undefined;
    const approval = cut.tepId ? s.tepApproval(cut.tepId) : { approved: false, reason: "unsigned" };
    if (!approval.approved) {
      s.runNote = `The build could not start: ${approval.reason} — re-sign the cut.`;
      s.changed(s.runNote);
      return undefined;
    }
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
    s.changed("Starting — refreshing the branch…");
    // The run is written down AS IT HAPPENS, not only when it is over.
    // A record kept until the end is a record nobody can read while they
    // need it — the surface holds the only copy, so a crash takes the
    // whole account with it, and nothing outside the window can say what
    // a worker is doing. Throttled: a run reports constantly, and this is
    // a file.
    let lastWrite = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const keep = (): void => {
      if (!s.runState) return;
      saveRun(s.deps.storeDir, { cutId, tepId: cut.tepId, at: s.deps.now() }, s.runState);
      lastWrite = Date.now();
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
      s.running = false;
      s.runNote = `The build stopped: ${verdict}`;
      keep();
      s.changed(s.runNote);
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
        s.running = false;
        s.runNote = `The build could not start: ${plan.reason}.`;
        s.changed(s.runNote);
        return undefined;
      }
      const anchorRefusal = s.deps.anchorless ? refuseAnchorless(plan, s.space) : undefined;
      if (anchorRefusal) {
        s.running = false;
        s.runNote = anchorRefusal;
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
        deps: s.deps,
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
          // Between the delivery held for this cut and the one arriving,
          // the run that produced it LAST stands — settled by the same rule
          // the fold applies to the same pair, so the two surfaces can never
          // disagree about one delivery id.
          const settled = at >= 0 ? settleDelivery(kept[at], delivery) : delivery;
          s.space = {
            ...s.space,
            deliveries: at >= 0 ? kept.map((d, i) => (i === at ? settled : d)) : [...kept, settled],
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
      if (last?.delivery?.withheld) {
        s.runNote = `The delivery was withheld: ${last.delivery.withheld}`;
        s.changed(s.runNote);
      } else if (last?.refusals.length && !last.delivery) {
        s.runNote = `The build stopped: ${last.refusals.join(" · ")}`;
        s.changed(s.runNote);
      } else if (last?.delivery) s.runNote = undefined;
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
      if (pending) clearTimeout(pending);
      // And once more at the end, so the last thing that happened is in
      // the record whatever the throttle was doing when it happened.
      keep();
    }
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
    return { ok: true };
  }
