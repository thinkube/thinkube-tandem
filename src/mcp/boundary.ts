/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a machine caller may do to a thinking space, and what only a person
 * may do.
 *
 * The two gates are the whole verification argument: a person signs what
 * will be built, and a person accepts what was built. Everything between
 * them is autonomous precisely BECAUSE those two ends are held by someone
 * the machine cannot be. A server that could sign its own work and accept
 * its own delivery would leave the checks in place and remove the reason
 * to believe them.
 *
 * So the boundary is not a second list. It reads the ONE declaration in
 * `surfaces/actions.ts`, where an action says whether it is the person's
 * alone and why — because two lists that must agree are two lists that
 * will not. `look_at` shipped as a tool and was refused on every call for
 * exactly that reason: it was in the tool list and not in the boundary.
 *
 * It is enforced at the one place every tool call passes through, and an
 * undeclared action is REFUSED, never allowed: the failure of forgetting
 * is a locked door rather than an open one.
 */

import { ACTIONS, AUTONOMOUS_ENV, labelOf, machineMay as declaredMay } from "../surfaces/actions";

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * What the person is asked when an agent reaches for one of their actions
 * through a client that can ask them (MCP elicitation). The gate stays a
 * human act: the agent's call waits, the person reads what is about to
 * happen and says yes or no, in their own session, without an
 * environment switch that would let every agent through.
 */
export function confirmation(
  action: string,
  toolName: string,
  args: Record<string, unknown>,
): {
  message: string;
  requestedSchema: {
    type: "object";
    properties: { yes: { type: "boolean"; title: string; description: string } };
    required: ["yes"];
  };
} {
  const why = ACTIONS[action]?.mine ?? "";
  const named = Object.entries(args)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return {
    message:
      `${labelOf(action)} — ${why}\n` +
      `An agent asks to run ${toolName}${named ? ` (${named})` : ""} on your behalf. ` +
      `This is yours to decide: yes lets it go ahead now, no refuses it and nothing is done.`,
    requestedSchema: {
      type: "object",
      properties: {
        yes: {
          type: "boolean",
          title: labelOf(action),
          description: `Yes: ${toolName} goes ahead now. No: it is refused.`,
        },
      },
      required: ["yes"],
    },
  };
}

/** Whether the person said yes: an accepted form whose answer is `yes`;
 *  a decline, a cancel, or an empty form is a no. */
export function confirmed(result: { action: string; content?: Record<string, unknown> }): boolean {
  return result.action === "accept" && result.content?.yes === true;
}

/**
 * Whether a machine caller may perform an action, and why not when it may
 * not — the action's own sentence, so a refusal explains rather than only
 * refuses.
 */
export function machineMay(action: string, env: NodeJS.ProcessEnv = process.env): Verdict {
  const a = ACTIONS[action];
  if (!a) {
    return {
      ok: false,
      reason: `${action} is not declared in ${"actions.ts"} — refused until it is`,
    };
  }
  const r = declaredMay(action, env);
  return r.ok ? r : { ok: false, reason: `${action} is yours, not mine: ${r.reason} (${AUTONOMOUS_ENV}=1 allows it)` };
}
