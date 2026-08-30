/**
 * What a worker may reach for, and what it is told when it may not.
 *
 * One subject: which tools each role is refused, why a refused use is
 * refused in words the worker can act on, and the lesson a unit reads the
 * first time it writes outside its clearance. The guard enforces; this
 * explains. It sat beside the worker because the worker installs the hooks;
 * it lives here because a file is split at a subject, never shaved.
 */
import { isTestPath } from "./testHomes";

/** Tools that could show an author the evidence it is judged by. */
const READ_TOOLS = ["Read", "Grep", "Glob", "NotebookRead"];

/**
 * Spawning another actor: closed to EVERY worker, the unfenced closer
 * included. Full authority is over the tree it was given, never the power
 * to create an actor no rung behind it can judge.
 */
export const DELEGATION_TOOLS = ["Task", "Agent", "Workflow", "Skill"] as const;

/**
 * The tools no worker gets, whatever its role — every door out of the
 * fence, not only the front one. Monitor is here because it runs shell
 * commands in an until-loop: with it, a fence on Bash fences nothing —
 * a blinded worker once used it to walk the runner worktrees, rebuild
 * one by hand, and commit its own work.
 */
export const FENCED_TOOLS = [
  "WebFetch",
  "WebSearch",
  ...DELEGATION_TOOLS,
  "Monitor",
  "AskUserQuestion",
  "ExitPlanMode",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitWorktree",
] as const;

/** Tools that could show an author the evidence it is judged by. */


/**
 * What a worker may not touch, decided in one place so a fence is a rule
 * rather than an expression repeated at each call site.
 *
 * `unfenced` means what it says. The closer is the last actor: it is asked
 * to bring a tree under the repository's own checks, and it cannot do that
 * without running them. Honouring the flag only at the write guard left it
 * declared unfenced and shell-less — so it could not ask the compiler what
 * was wrong, and reported a cause it had inferred ("there is no tsc")
 * about a tree whose dependencies were present. A one-line unused import
 * withheld a finished delivery behind that guess.
 *
 * Delegation stays closed even there: full authority is over the TREE —
 * read it, build it, repair it — never the power to spawn an actor no rung
 * behind it can judge.
 */
export function toolsRefusedTo(w: { unfenced?: boolean; role?: string; blind?: boolean }): string[] {
  if (w.unfenced) return [...DELEGATION_TOOLS];
  return [...(w.role === "test" || w.blind ? ["Bash"] : []), ...FENCED_TOOLS];
}
export function clearanceLesson(bad: readonly string[], footprint: readonly string[]): string {
  return (
    `${bad.join(", ")} was restored: it is not yours to change, so that edit is gone and the file is as it was. ` +
    `This is not a refusal of the change — it is the order. Say which file you need and which criterion requires it, ` +
    `and the run rules on it and clears you; then you make the change yourself, in this session. ` +
    `Until then what you may write is: ${footprint.join(", ")}. ` +
    `Write outside it again and the unit ends here.`
  );
}
/**
 * One line for what a worker just did: the tool and the thing it did it
 * to. A log of bare tool names says a worker was busy; a log naming the
 * file says what it built.
 */
export function describeTool(b: Record<string, unknown>): string {
  const name = typeof b.name === "string" ? b.name : "tool";
  const input = (b.input ?? {}) as Record<string, unknown>;
  const of =
    ["file_path", "path", "pattern", "command", "notebook_path"]
      .map((k) => (typeof input[k] === "string" ? (input[k] as string) : ""))
      .find(Boolean) ?? "";
  return of ? `${name} ${of.length > 120 ? `${of.slice(0, 120)}…` : of}` : name;
}
/** Held-out evidence: a probe, or any test-shaped path — one rule. */
function isHeldOut(target: string): boolean {
  return isTestPath(target);
}
/** Why a tool use is refused before it runs, or nothing. A coder never
 *  reads held-out evidence when blinded, and never writes a test-shaped
 *  path at all — tests are the tester's, whatever the footprint says. */
export function refusedToolUse(
  deps: { role: "code" | "test"; blind?: boolean },
  tool: string,
  target: string,
): string | undefined {
  if (!target) return undefined;
  if (deps.role === "code" && ["Write", "Edit", "NotebookEdit"].includes(tool) && isHeldOut(target))
    return "tests are the tester's — a coder never writes a test or probe file; build to the contract and ask `verify`";
  if (deps.blind && READ_TOOLS.includes(tool) && isHeldOut(target))
    return "the checks are held out — ask `verify` how you are doing instead of reading them";
  return undefined;
}
