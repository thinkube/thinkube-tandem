import { AcResult, AcVerification } from "./closingGate";
import { Fault } from "./redispatch";
// ── Durable, structured verification trace (SP-6/7 AC5) ────────────────────
//
// The delivery report's per-AC table is ephemeral prose; AC5 needs a DURABLE, structured record —
// per AC and per rework round — of HOW each criterion was verified, so the methodology itself can be
// debugged and improved. `buildVerificationTrace` derives that structure from the per-AC results: for
// each AC it records the verification `kind` (a held-out `probe` command vs an independent
// `assessment`), the `verdict`, the assessor/judge `rationale`, and — when the run was red and judged
// — the code-vs-test `route`. The shell persists it as JSON alongside DELIVERY.md (accumulating across
// runs, keyed by AC + round) and surfaces it in the delivery report + panel.

/** One entry of the structured verification trace (SP-6/7 AC5) — one AC's verdict in one rework round. */
export interface VerificationTraceEntry {
  /** 1-based AC ordinal this entry records. */
  ac: number;
  /** The rework round it was verified in (1 = the first attempt; bumped each re-dispatch). */
  round: number;
  /** How it was verified: a held-out `probe` command, or an independent `assessment`. */
  kind: "probe" | "assessment";
  verdict: "pass" | "fail";
  /** The assessor's rationale / the probe's evidence tail — why this verdict. */
  rationale?: string;
  /** SP-6/7 AC4: the judged code-vs-test route recorded for a FAILED AC (absent on a pass / un-judged). */
  route?: Fault;
}

/** Inputs to {@link buildVerificationTrace}: one run's per-AC results + how to place each in the trace. */
export interface VerificationTraceInput {
  /** The rework round this run represents for the AC's slice (1-based). A number, or a per-AC lookup. */
  round: number | ((ac: number) => number);
  /** The declared per-AC plan — its `env` distinguishes `assessment` from a runnable `probe`. */
  declared: AcVerification[];
  /** The per-AC results (pass/fail + evidence) this run produced. */
  acResults: AcResult[];
  /** AC ordinal → the judged re-dispatch route for a FAILED AC (SP-6/7 AC4). */
  routes?: ReadonlyMap<number, Fault> | Record<number, Fault>;
}

/**
 * Build one run's slice of the structured verification trace (SP-6/7 AC5): one entry per AC result,
 * recording its round, verification kind (`assessment` when the declared `env` is `assessment`, else a
 * held-out `probe`), verdict, rationale (the evidence tail — the assessor's rationale for an
 * assessment, the command output for a probe), and — for a failed, judged AC — the code-vs-test route.
 * Pure → unit-tested; the shell merges these into the durable per-Spec trace file. See AC5.
 */
export function buildVerificationTrace(
  i: VerificationTraceInput,
): VerificationTraceEntry[] {
  const envByAc = new Map(i.declared.map((v) => [v.ac, v.env]));
  const roundOf = (ac: number): number =>
    typeof i.round === "function" ? i.round(ac) : i.round;
  const routeOf = (ac: number): Fault | undefined => {
    const r = i.routes;
    if (!r) return undefined;
    return r instanceof Map ? r.get(ac) : (r as Record<number, Fault>)[ac];
  };
  return i.acResults.map((r) => {
    const kind: VerificationTraceEntry["kind"] =
      envByAc.get(r.ac) === "assessment" ? "assessment" : "probe";
    const entry: VerificationTraceEntry = {
      ac: r.ac,
      round: roundOf(r.ac),
      kind,
      verdict: r.pass ? "pass" : "fail",
      rationale: (r.evidence ?? "").trim() || undefined,
    };
    const route = routeOf(r.ac);
    if (!r.pass && route) entry.route = route;
    return entry;
  });
}

/**
 * SP-11/2 — the id of a post-orchestration exit. The exit SET is derived from the run's terminal
 * state (see {@link deliveryExitState}), never glued on fixed: a **delivered** run offers
 * `accept` / `request-changes`; a **stalled** run offers `attend` / `rerun` — no impossible
 * `accept` on a stalled run, no mislabeled reject.
 */
type ExitActionId = "accept" | "request-changes" | "attend" | "rerun";

/** SP-11/2 — one post-orchestration exit: a stable `id` (dispatched on) + its human `label`. */
interface ExitAction {
  id: ExitActionId;
  label: string;
}

/**
 * SP-11/2 — the SINGLE source of truth mapping a run's terminal state to its exit set. Both the
 * delivery report's `## Next` section and the graph's buttons consume THIS (no second derivation):
 *
 *   • **delivered** ⇔ the change committed AND the closing gate passed → exits
 *     `[accept ("Accept & merge"), request-changes ("Request changes")]`, in that order;
 *   • **stalled** ⇔ anything else (not committed and/or the gate did not pass) → exits
 *     `[attend ("Attend"), rerun ("Re-run")]`, in that order — the actions that actually apply to a
 *     run that did not deliver (no impossible Accept, no mislabeled Reject).
 *
 * Labels are pinned exactly. Pure → unit-tested.
 */
function deliveryExitState(run: {
  committed: boolean;
  gatePassed: boolean;
}): { state: "delivered" | "stalled"; exits: ExitAction[] } {
  return run.committed && run.gatePassed
    ? {
        state: "delivered",
        exits: [
          { id: "accept", label: "Accept & merge" },
          { id: "request-changes", label: "Request changes" },
        ],
      }
    : {
        state: "stalled",
        exits: [
          { id: "attend", label: "Attend" },
          { id: "rerun", label: "Re-run" },
        ],
      };
}

