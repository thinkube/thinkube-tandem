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
 * So the boundary is declared here, as data, and enforced at the one place
 * every tool call passes through — not left to whoever writes the tool
 * list to remember. Omitting a tool is a convention; refusing an action is
 * a rule.
 */

/** Actions a machine caller may perform on a space. */
export const MACHINE_MAY = [
  // Reading, in every shape.
  "read-space",
  "read-run",
  "read-delivery",
  "read-defects",
  "read-log",
  "read-allowed",
  // Reading the draft into a proposal, and computing from what is
  // recorded: proposing is not deciding.
  "read-draft",
  "capture-many",
  "cancel-capture",
  "think",
  "propose-check",
  "open-cut-review",
  // Writing that stops short of a gate.
  "save-draft",
  "reground",
  "answer-worker",
  "stop-run",
  "rerun",
  // Propagating a decision the person already made: applying a staged
  // implication re-derives the asks it touches and invents nothing.
  "accept-impact",
  "apply-all-impacts",
  // Proposing how the asks group is derivation, like any other reading:
  // it invents nothing and decides nothing.
  "group-into-sets",
] as const;

/**
 * Actions that are the person's alone, each with the reason, so a refusal
 * says why rather than only that.
 *
 * `keep-draft` is here deliberately and may look surprising: drafting text
 * is not authoring an ask. A machine may put words in the box; turning
 * them into the record of what a person wants is the person's act, and it
 * is the only thing standing between "the machine proposed" and "the
 * machine decided what I want".
 */
export const PERSON_ONLY: Record<string, string> = {
  "choose-set":
    "which set is built next decides what you get to look at, and in what order — a machine may propose the sets, never pick one",
  build: "signing a cut is the first gate — a machine may not sign work it will then do",
  "keep-draft": "turning drafted words into your asks is yours; a machine may draft, never keep",
  "accept-delivery": "accepting a delivery is the second gate — a machine may not accept its own work",
  "reject-delivery": "rejecting a delivery is a judgement about the work, and it is yours",
  attest:
    "attesting is the answer to a promise nothing mechanical could settle — installed on a clean " +
    "node, seen working. A machine saying it held would be inventing the one verdict it cannot reach",
  "mint-approval": "an approval stands for your click; a machine minting one forges it",
  "think-again": "withdrawing signed work discards what you approved — yours to decide",
  panic: "clearing what was derived is destructive and yours to decide",
  "exempt-docs": "recording that documentation is not needed is a judgement, and it is yours",
  reframe: "your ask is your words — a machine may never rewrite them",
  amend: "your ask is your words — a machine may never rewrite them",
  "dismiss-promise": "dropping a promise narrows what gets built, and narrowing is yours",
  "accept-check": "a check you accept is one you vouched for; a machine may propose, never accept",
  "accept-question": "your answer becomes a decision in force — only you can give it",
  "dismiss-impact": "discarding what a decision implies is a judgement, and it is yours",
  "switch-repo": "changing which project you are working on moves the ground under you",
};

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether a machine caller may perform an action. Unknown actions are
 * REFUSED, never allowed: a tool added later is refused until it is
 * declared here, so the failure of forgetting is a locked door rather than
 * an open one.
 */
export function machineMay(action: string): Verdict {
  if ((MACHINE_MAY as readonly string[]).includes(action)) return { ok: true };
  const why = PERSON_ONLY[action];
  if (why) return { ok: false, reason: `${action} is yours, not mine: ${why}` };
  return {
    ok: false,
    reason: `${action} is not declared in the machine boundary — refused until it is`,
  };
}
