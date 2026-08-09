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
    s.runState = new RunState(() => s.deps.onChanged?.());
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
      let last;
      last = await dispatchScopePlan({
        plan,
        cut,
        space: () => s.space,
        deps: s.deps,
        runState: s.runState!,
        spaceName: path.basename(s.deps.storeDir),
        onDelivery: (delivery, note) => {
          s.space = { ...s.space, deliveries: [...s.space.deliveries, delivery] };
          s.changed(note);
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
      // The run is over, so it becomes history: the page that shows it is
      // opened long after the process that ran it has gone.
      if (s.runState) saveRun(s.deps.storeDir, { cutId, tepId: cut.tepId, at: s.deps.now() }, s.runState);
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
