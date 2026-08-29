/**
 * How this repository runs its WHOLE suite — the one command the closing
 * gate's last judgement rests on.
 *
 * It lives apart from the door because it is the only one of the five
 * commands a run needs that nothing ever read from the repository. The
 * other four are derived; this one was a caller's setting with a default
 * behind it. When the default was removed the value became "", was carried
 * politely through five hand-offs, and was executed at the final step of a
 * seventy-minute run.
 */
import type { SetupArgs } from "./setup";

const since = (t0: number): string => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const firstLine = (output: string): string => output.trim().split("\n").pop() ?? "";

/**
 * The repository's own whole-suite command, PROVED before it is trusted.
 *
 * It used to be a default — `npm test` — written into five call sites. A
 * repository in any other language got it anyway: the gate ran a command
 * that could not exist there, read the shell's "command not found" as the
 * suite's verdict, and withheld the delivery for it. The person was told
 * their standing checks were red.
 *
 * Proved the way the single-test command is: run it on the untouched tree
 * and see whether a RUNNER answered. A red suite on the base is the base's
 * business and the answer still holds — what disqualifies a command is
 * failing to run at all. An answer that does not hold is dropped rather
 * than used, and the run says so instead of judging by it.
 */
/**
 * Did a test runner ANSWER, or did the command fail to run at all?
 *
 * The one rule, used both when the command is first proved and when the
 * closing gate judges by it. Red is an answer — a repository's own tests
 * failing is its business. "command not found" is not an answer, and
 * reporting it as a red suite tells a person their work broke when what
 * broke is the run's idea of how to test their repository.
 */
export function aRunnerAnswered(code: number | null, output: string): boolean {
  return (
    code === 0 ||
    /^(not )?ok \d+|\b\d+ (passed|failed|failures?)\b|^(--- )?(PASS|FAIL)\b|^# (tests|fail)/m.test(output)
  );
}

export async function proveSuite(
  args: Pick<SetupArgs, "worktree" | "boundedExec" | "log">,
  suite: string,
): Promise<string> {
  if (!suite.trim()) return "";
  args.log(`proving the repository's own suite: ${suite}`);
  const t0 = Date.now();
  const r = await args.boundedExec(suite, args.worktree);
  const ran = aRunnerAnswered(r.code, r.output);
  args.log(
    `  ${ran ? "held" : "did not hold"} in ${since(t0)}` +
      (ran ? "" : ` — ${firstLine(r.output).slice(0, 300)}`),
  );
  return ran ? suite : "";
}

/**
 * The door's arguments for one run, assembled from what the repository
 * already proved about itself and what this dispatch was told.
 *
 * A repository's own answer wins over anything a caller assumed: the
 * caller's was a default in five places, and a repository in another
 * language got it regardless.
 */
/**
 * The whole-suite command, asked of the repository when nobody has told
 * the run one.
 *
 * The gate's last judgement is this command's verdict on the delivered
 * tree. Four of the five commands a run needs are read from the repository
 * itself; this one was only ever a caller's setting. When the setting went
 * away the value became the empty string, was carried politely through
 * five hand-offs, and was executed at the final step of a seventy-minute
 * run — after every unit was done and every criterion assessed.
 *
 * So it is read the same way as the other four, from the same reading, and
 * a repository that cannot answer stops the run at its first minute.
 */
export async function askForTheSuite(a: {
  resetup?: SetupArgs["resetup"];
  log: (line: string) => void;
}): Promise<string> {
  if (!a.resetup) return "";
  a.log("no whole-suite command is known — asking the repository for its own");
  const again = await a
    .resetup(
      "no command is known for running this repository's WHOLE suite. The gate " +
        "judges a delivered tree by that command's verdict, so the run cannot " +
        "decide anything without it.",
    )
    .catch(() => undefined);
  return again?.suite ?? "";
}
