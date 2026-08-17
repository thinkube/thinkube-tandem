/**
 * One dispatch per scope, in plan order (§7quater): each repository the
 * TEP touches gets its own worktree, branch and delivery; the anchor
 * scope resolves from the session's own binding, member scopes from the
 * open workspace. A scope that is not open, a refused adapter, or a
 * refused run stops the sequence with the reason spoken.
 */
import { Cut, Delivery, Space } from "../core/schema";
import { SessionDeps } from "../surfaces/session";
import { tepSlices } from "./adapter";
import { qualifyProbes, qualifySpace, ScopePlan } from "./scopes";
import { dispatchTep, DispatchOutcome } from "../run/dispatch";
import { RunState } from "../run/state";
import { runReadRound } from "../derive/round";

export async function dispatchScopePlan(args: {
  plan: Extract<ScopePlan, { ok: true }>;
  cut: Cut;
  space: () => Space;
  deps: SessionDeps;
  runState: RunState;
  spaceName: string;
  /** The anchor repository's reading — briefs in member scopes never get
   *  it; a digest of one repository is not knowledge of another. */
  digest?: string;
  /** The anchor repository's check-setup facts, machine-derived (or the
   *  human's settings override) — same scope rule as the digest. */
  provision?: string;
  prepare?: string;
  resetup?: (evidence: string) => Promise<{ provision: string; prepare: string }>;
  proveSetup?: (s: { provision: string; prepare: string }) => void;
  onDelivery: (delivery: Delivery, note: string) => void;
  /** Where each criterion's standing check now lives — bound per scope,
   *  as each delivery lands. */
  onAnchors?: (anchors: NonNullable<DispatchOutcome["proofAnchors"]>) => void;
  changed: (message: string) => void;
}): Promise<DispatchOutcome | undefined> {
  const { groups, order } = args.plan;
  const deps = args.deps;
  const dispatch = deps.dispatch ?? dispatchTep;
  let last: DispatchOutcome | undefined;
  for (const sc of order) {
    const target =
      sc === ""
        ? {
            gitRoot: deps.scope?.gitRoot ?? deps.round.repoRoot,
            prefix: deps.scope?.prefix ?? "",
            forge: deps.forge,
          }
        : await deps.resolveScope?.(sc);
    if (!target) {
      args.changed(
        `Dispatch stopped: scope "${sc}" is not open in this workspace — open its repository and re-sign.`,
      );
      break;
    }
    const prefix = target.prefix ?? "";
    const scopedCut = { ...args.cut, changeIds: groups.get(sc)! };
    let slices;
    try {
      slices = tepSlices({
        space: qualifySpace(args.space(), prefix),
        cut: scopedCut,
        spaceName: deps.scope?.projectId ?? args.spaceName,
        handlePrefix: sc ? `${sc}.` : "",
      });
      qualifyProbes(slices, prefix);
    } catch (err) {
      args.changed(`Dispatch refused: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    const outcome = await dispatch(
      {
        repoRoot: target.gitRoot,
        projectId: deps.scope?.projectId,
        model: deps.round.model,
        workerModel: deps.workerModel,
        concurrency: deps.maxConcurrent,
        suiteCommand: deps.suiteCommand ?? ["npm", "test"],
        forge: target.forge ?? deps.forge,
        state: args.runState,
        spaceName: args.spaceName,
        storeDir: deps.storeDir,
        supervisorRound: runReadRound,
        ...(sc === "" && args.prepare
          ? { prepare: args.prepare }
          : deps.prepareCommand
            ? { prepare: deps.prepareCommand }
            : {}),
        ...(sc === "" && args.provision ? { provision: args.provision } : {}),
        ...(sc === "" && args.resetup ? { resetup: args.resetup } : {}),
        ...(sc === "" && args.proveSetup ? { proveSetup: args.proveSetup } : {}),
        ...(sc === "" && args.digest ? { digest: args.digest } : {}),
      },
      args.space(),
      scopedCut,
      slices,
    );
    last = outcome;
    if (outcome.proofAnchors?.length) args.onAnchors?.(outcome.proofAnchors);
    if (outcome.delivery) {
      const delivery = {
        ...outcome.delivery,
        id: sc ? `${outcome.delivery.id}-${sc}` : outcome.delivery.id,
        ...(outcome.url ? { url: outcome.url } : {}),
        ...(outcome.undelivered.length ? { undelivered: outcome.undelivered } : {}),
      };
      args.onDelivery(
        delivery,
        (delivery.withheld
          ? `Delivery withheld on ${delivery.branch}${sc ? ` (scope ${sc})` : ""} — the record says why.`
          : `Delivery ready on ${delivery.branch}${sc ? ` (scope ${sc})` : ""}.`) +
          (order.length > 1 ? ` ${order.indexOf(sc) + 1}/${order.length} scopes.` : ""),
      );
      if (delivery.withheld) return outcome;
    } else {
      args.changed(`The run refused: ${outcome.refusals.join("; ")}`);
      break;
    }
  }
  return last;
}
