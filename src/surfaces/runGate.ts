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
import { DispatchOutcome } from "../run/dispatch";
import { RunState } from "../run/state";
import { saveRun } from "../run/record";
import { acceptOrder } from "../engine/acceptOrder";
import type { TandemSession } from "./session";
import * as path from "node:path";

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
    s.runNote = undefined;
    s.running = true;
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
    s.runState = new RunState(() => {
      s.deps.onChanged?.();
      if (Date.now() - lastWrite >= 2000) keep();
      else if (!pending)
        pending = setTimeout(() => {
          pending = undefined;
          keep();
        }, 2000);
    });
    s.changed(`Building ${cut.tepId ?? cutId}…`);
    try {
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
      // The repository reading rides into every worker's brief. Cached
      // under the repo stamp, so after a derivation this costs nothing;
      // a run must never refuse over brief enrichment, hence fail-soft.
      const digest = await s
        .knowledge()
        .then((k) => k.digest)
        .catch(() => undefined);
      let last;
      last = await dispatchScopePlan({
        plan,
        cut,
        space: () => s.space,
        deps: s.deps,
        runState: s.runState!,
        spaceName: path.basename(s.deps.storeDir),
        ...(digest ? { digest } : {}),
        onDelivery: (delivery, note) => {
          s.space = { ...s.space, deliveries: [...s.space.deliveries, delivery] };
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
      if (last?.refusals.length && !last.delivery) {
        s.runNote = `The build stopped: ${last.refusals.join(" · ")}`;
        s.changed(s.runNote);
      } else if (last?.delivery) s.runNote = undefined;
      return last;
    } finally {
      s.running = false;
      if (pending) clearTimeout(pending);
      // And once more at the end, so the last thing that happened is in
      // the record whatever the throttle was doing when it happened.
      keep();
    }
  }

export async function acceptDeliveryGesture(s: TandemSession, deliveryId: string): Promise<{ ok: boolean; reason?: string }> {
    const d = s.space.deliveries.find((x) => x.id === deliveryId);
    if (!d) return { ok: false, reason: `no delivery '${deliveryId}'` };
    const r = acceptDelivery(d, s.deps.now(), s.deps.docsGateMode ?? "blocking");
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
