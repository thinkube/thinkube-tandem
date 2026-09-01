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

import { ACTIONS, machineMay as declaredMay } from "../surfaces/actions";

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether a machine caller may perform an action, and why not when it may
 * not — the action's own sentence, so a refusal explains rather than only
 * refuses.
 */
export function machineMay(action: string): Verdict {
  const a = ACTIONS[action];
  if (!a) {
    return {
      ok: false,
      reason: `${action} is not declared in ${"actions.ts"} — refused until it is`,
    };
  }
  const r = declaredMay(action);
  return r.ok ? r : { ok: false, reason: `${action} is yours, not mine: ${r.reason}` };
}
