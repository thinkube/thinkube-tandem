/**
 * Asking the tool whether the work settles, instead of writing a check about it.
 *
 * Declarative work cannot be honestly checked by a written test. A playbook
 * says a package is installed; a check asserting that the playbook says so
 * restates the file in a second language, passes for a playbook that could
 * never run, and is testing the tool rather than the work. The same is true
 * of terraform, helm, kustomize and everything shaped like them.
 *
 * The tool already has the answer and gives it in three parts:
 *
 *   still   look without changing anything — lint, syntax, a dry run
 *   apply   do the work
 *   ask     say whether anything is left to do
 *
 * The third is the one no test gives you. Work that still changes things the
 * second time it is asked does not settle, and nobody writes a test for that
 * — it is usually a step with no guard, doing its work every time it runs.
 *
 * Nothing here knows what any tool is. The commands come from the
 * repository's own `thinkube.yaml`, so a tool nobody has chosen yet needs no
 * change to this file.
 *
 * A tool that cannot be reached judges nothing. A missing binary or an
 * unreachable inventory is a fact about this machine, and returning red for
 * it would blame the work for the machine's own limits.
 */
import type { ThinkubeVerify } from "../core/thinkubeYaml";
import type { Invoke } from "./makeLive";

export interface Settled {
  /** green: the tool answered and was satisfied. red: it answered and was
   *  not. unjudged: it never answered, which says nothing about the work. */
  verdict: "green" | "red" | "unjudged";
  /** The tool's own words, never a paraphrase of them. */
  detail: string;
}

/** A failure of the tooling rather than of the work. */
function outOfReach(out: string): boolean {
  return /command not found|No such file or directory|not recognized as|Unable to (?:connect|parse)|Could not match supplied host pattern/i.test(
    out,
  );
}

/**
 * Run what the repository declared and read the tool's answer.
 *
 * `still` first, because a repository that does not lint or parse has nothing
 * worth applying. Then `apply`, then `ask` — and the answer to `ask` is
 * measured against `settled` when the repository says what settled looks
 * like, or against the command exiting cleanly when it does not.
 */
export async function askTheTool(a: {
  repoRoot: string;
  verify: ThinkubeVerify;
  invoke: Invoke;
  log?: (line: string) => void;
}): Promise<Settled> {
  const said: string[] = [];

  for (const command of a.verify.still) {
    a.log?.(`asking the tool: ${command}`);
    const r = await a.invoke(command, a.repoRoot);
    if (r.code === 0) continue;
    if (outOfReach(r.out))
      return { verdict: "unjudged", detail: `\`${command}\` could not run here:\n${r.out.slice(-400)}` };
    said.push(`\`${command}\` exited ${r.code}\n${r.out.slice(-800)}`);
  }
  if (said.length) return { verdict: "red", detail: said.join("\n\n") };
  if (!a.verify.apply)
    return { verdict: "green", detail: `nothing to correct: ${a.verify.still.join(", ")}` };

  a.log?.(`doing the work: ${a.verify.apply}`);
  const first = await a.invoke(a.verify.apply, a.repoRoot);
  if (first.code !== 0)
    return outOfReach(first.out)
      ? { verdict: "unjudged", detail: `the work could not be done here:\n${first.out.slice(-400)}` }
      : { verdict: "red", detail: `\`${a.verify.apply}\` exited ${first.code}\n${first.out.slice(-800)}` };

  const ask = a.verify.ask;
  if (!ask)
    return { verdict: "green", detail: `${a.verify.apply} did the work; the repository names nothing to ask afterwards` };

  a.log?.(`asking whether anything is left: ${ask}`);
  const again = await a.invoke(ask, a.repoRoot);
  if (again.code !== 0 && outOfReach(again.out))
    return { verdict: "unjudged", detail: `the work was done; asking again could not run:\n${again.out.slice(-400)}` };

  const settles = a.verify.settled
    ? new RegExp(a.verify.settled).test(again.out)
    : again.code === 0;
  return settles
    ? { verdict: "green", detail: `the work was done, and asking again says nothing is left to do` }
    : {
        verdict: "red",
        detail:
          `the work was done, but asking again says there is still something to do — it does not settle. ` +
          `Usually a step with no guard, doing its work every time it is asked.\n${again.out.slice(-800)}`,
      };
}
