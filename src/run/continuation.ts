/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A chained code unit's first round continues its predecessor's session.
 *
 * When the planner cuts one subject into slices that each build on the one
 * before, every code unit requires the previous code unit, and they run one
 * after another. Started cold, each one explores the same code again before
 * it writes a line. Continued, it starts with what the previous coder
 * already read in its context, and the new unit's brief is the next message.
 *
 * The session is forked, never continued in place: the predecessor keeps
 * its own session for a later repair of its own work, and two successors
 * of one unit never write into one transcript.
 *
 * What does not change: the footprint guard runs with the new unit's
 * footprint, and a blinded coder only continues a session that was itself
 * blinded, so no check source reaches it through the context.
 *
 * When the predecessor's session cannot be continued, the unit starts cold
 * and the log says why. That is the way every unit started before, so the
 * unit loses only the head start.
 */
import type { RunWorkerDeps, WorkerOutcome } from "./worker";

/** How a unit's first round starts. */
export type FirstRound =
  /** It continues the session `session`, in which `from` was worked. */
  | { kind: "continue"; from: string; session: string }
  /** It follows a code unit, but starts cold, for the reason given. */
  | { kind: "cold"; why: string }
  /** It follows no code unit: a cold start is the only start. */
  | { kind: "first" };

/**
 * How a unit's first round starts, from what the run knows about the code
 * units it requires.
 */
export function firstRoundOf(
  unit: { id: string; requires: readonly string[] },
  a: {
    /** Whether this unit is a code unit; only a coder continues a coder. */
    coder: boolean;
    /** Whether this unit's coder is blinded to the checks. */
    blind: boolean;
    /** Whether a unit of the run is a code unit worked as a coder. */
    isCoder: (id: string) => boolean;
    /** The session each finished unit was worked in. */
    sessions: ReadonlyMap<string, string>;
    /** Units whose recorded session was worked blinded. */
    blindSessions: ReadonlySet<string>;
    /** Units that failed. */
    failed: ReadonlySet<string>;
  },
): FirstRound {
  if (!a.coder) return { kind: "first" };
  const before = unit.requires.filter((id) => a.isCoder(id));
  if (!before.length) return { kind: "first" };
  if (before.length > 1)
    return {
      kind: "cold",
      why: `it follows ${before.length} code units (${before.join(", ")}), and one session continues one line of work`,
    };
  const from = before[0];
  if (a.failed.has(from)) return { kind: "cold", why: `${from} failed, so its session is not a base to build on` };
  const session = a.sessions.get(from);
  if (!session) return { kind: "cold", why: `${from} left no session this run can continue` };
  if (a.blind && !a.blindSessions.has(from))
    return {
      kind: "cold",
      why: `${from} was not worked blinded, so its session may hold check sources this coder must not see`,
    };
  return { kind: "continue", from, session };
}

/** The new unit's brief, as the next message in the predecessor's session. */
export function continuationBrief(from: string, brief: string): string {
  return [
    `THE NEXT UNIT CONTINUES IN THIS SESSION. You finished ${from}, and its work is in the tree.`,
    "What you read for it is still in your context: use it. Read a file again only where another unit may have changed it since.",
    "The brief below REPLACES the previous one. Its footprint, its rules and its checks are the ones that hold now; " +
      "a file you were cleared to change before is not cleared now unless the brief below says so.",
    "",
    brief,
  ].join("\n");
}

/**
 * Run a unit's first round as `start` says. A continuation the model's SDK
 * refuses — the round ends in an error before any session answered — is
 * said in the log with the SDK's words, and the round runs again cold.
 */
export async function runFirstRound(a: {
  start: FirstRound;
  unit: string;
  worker: (deps: RunWorkerDeps, brief: string) => Promise<WorkerOutcome>;
  deps: RunWorkerDeps;
  brief: string;
  log: (line: string) => void;
}): Promise<{ outcome: WorkerOutcome; began: string }> {
  if (a.start.kind === "cold") a.log(`❄ ${a.unit}: starts cold — ${a.start.why}`);
  if (a.start.kind === "first") return { outcome: await a.worker(a.deps, a.brief), began: "started cold" };
  if (a.start.kind === "cold") return { outcome: await a.worker(a.deps, a.brief), began: `started cold: ${a.start.why}` };
  const { from, session } = a.start;
  a.log(`↪ ${a.unit}: continues ${from}'s session ${session} — what it read stays in context`);
  const outcome = await a.worker({ ...a.deps, resume: session, fork: true }, continuationBrief(from, a.brief));
  const began = `continued ${from}'s session`;
  // A stopped unit is not a refusal: there is nothing to start again.
  if (outcome.sessionId || outcome.ok || outcome.containment || a.deps.abort.signal.aborted) return { outcome, began };
  const words = (outcome.undelivered ?? []).join("; ") || "the round ended before any session answered";
  a.log(`❄ ${a.unit}: ${from}'s session ${session} could not be continued — ${words}; it starts cold`);
  return {
    outcome: await a.worker(a.deps, a.brief),
    began: `started cold: ${from}'s session could not be continued`,
  };
}
