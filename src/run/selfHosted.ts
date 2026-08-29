/**
 * When a run judges the machinery that judges it.
 *
 * Tandem developing Tandem is self-hosting: the cut under test changes the
 * very rules the gate applies. Those rules run in whatever process started
 * the run, loaded from wherever that process was launched — the checkout,
 * which is on another branch. So a cut that corrects a judging rule is
 * judged by the rule it corrects, fails for exactly the reason it fixes,
 * and cannot ever be delivered.
 *
 * It happened, and it cost a whole plan: seventeen promises came back
 * unkept with "the drive passed without executing a line of the code this
 * promise lands in". Both corrections were on the branch. Neither was
 * visible to the thing doing the judging. The closer proved it by hand and
 * refused to fix it by checking the branch out in the person's own
 * checkout, because that is a change thrown away when the run ends.
 *
 * So: when the tree under test is the same repository as the running
 * rules, the rules are loaded from the tree under test. A run judges the
 * branch by the branch's rules — which is the only reading of "the work is
 * judged by execution" that is not circular.
 *
 * Detected by asking git, never by a name: whose repository is this code
 * in, and whose repository is being judged.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** The repository a path belongs to, by its common git directory — so a
 *  worktree and the checkout it was cut from answer the same. */
export function repositoryOf(dir: string): string {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? fs.realpathSync(out) : "";
  } catch {
    return "";
  }
}

/**
 * Is this run judging its own machinery?
 *
 * True when the rules doing the judging live in the same repository as the
 * tree being judged — whatever either is called, and whichever branch each
 * is on.
 */
export function judgingItself(worktree: string, rulesAt: string = __dirname): boolean {
  const judged = repositoryOf(worktree);
  const judging = repositoryOf(rulesAt);
  return !!judged && judged === judging;
}

/**
 * A judging rule, taken from the tree under test when that tree is the one
 * that defines it.
 *
 * There is no falling back to the running rule. When a run judges its own
 * machinery, the running rule is the OLD rule — the one the cut exists to
 * correct — and using it is the whole defect: it produced seventeen unkept
 * promises for a fault both of the branch's commits had already fixed, and
 * nothing in the report could attribute them. Silently judging by stale
 * rules is worse than not judging, because it looks like a verdict about
 * the work.
 *
 * So: not self-hosting, and the running rule IS the rule — same code, no
 * loading, nothing to decide. Self-hosting, and the rule comes from the
 * tree or the run says it cannot judge this cut and stops. The door builds
 * the tree before the gate reads it, so a missing build is a machine fault
 * with a name, not a reason to guess.
 */
export async function ruleFromTreeUnderTest<T>(a: {
  worktree: string;
  builtAs: string;
  /** The rule as this process has it — used ONLY when the run is not
   *  judging the repository that defines it. */
  running: T;
  name: string;
  log?: (line: string) => void;
  /** Injectable for drives: where the rules doing the judging live. */
  rulesAt?: string;
}): Promise<{ ok: true; rule: T } | { ok: false; reason: string }> {
  if (!judgingItself(a.worktree, a.rulesAt ?? __dirname)) return { ok: true, rule: a.running };
  const at = path.join(a.worktree, a.builtAs);
  if (!fs.existsSync(at))
    return {
      ok: false,
      reason:
        `this cut changes the rules that judge it, and ${a.builtAs} is not built in the tree under test — ` +
        `judging it with the rules this run was started with would apply the very rule the cut corrects`,
    };
  try {
    const loaded = (await import(at)) as Record<string, unknown>;
    const rule = loaded[a.name] as T | undefined;
    if (!rule)
      return {
        ok: false,
        reason: `this cut changes the rules that judge it, and its own ${a.builtAs} does not export ${a.name}`,
      };
    a.log?.(`this cut changes the rules that judge it — judging it by its own ${a.name}`);
    return { ok: true, rule };
  } catch (e) {
    return {
      ok: false,
      reason:
        `this cut changes the rules that judge it, and its own ${a.builtAs} could not be loaded: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * The two rules that decide whether a promise is kept, taken from the tree
 * under test when that tree defines them.
 *
 * Asked for together because a run judges by both, and judging by a new
 * one and an old one is its own kind of wrong.
 */
export async function judgingRules<M, W>(a: {
  worktree: string;
  running: { criterionMapOf: M; provedByExecution: W };
  log?: (line: string) => void;
}): Promise<{ ok: true; criterionMapOf: M; provedByExecution: W } | { ok: false; reason: string }> {
  const map = await ruleFromTreeUnderTest({
    worktree: a.worktree,
    builtAs: "out/run/criteria.js",
    name: "criterionMapOf",
    running: a.running.criterionMapOf,
    ...(a.log ? { log: a.log } : {}),
  });
  if (!map.ok) return map;
  const wiring = await ruleFromTreeUnderTest({
    worktree: a.worktree,
    builtAs: "out/run/wiring.js",
    name: "provedByExecution",
    running: a.running.provedByExecution,
    ...(a.log ? { log: a.log } : {}),
  });
  if (!wiring.ok) return wiring;
  return { ok: true, criterionMapOf: map.rule, provedByExecution: wiring.rule };
}
