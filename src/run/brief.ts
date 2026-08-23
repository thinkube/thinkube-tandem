/**
 * What the code author is told about its own feedback.
 *
 * Under tests-first the probes are written before the coder starts, and the
 * oracle's rule is "probe source never reaches the coder; results do". The
 * tool denials in `runWorker` enforce that; this is where it is SAID, so
 * the author knows why it has no shell rather than discovering it as a
 * failure. Both halves have to exist: a gate nobody explains reads as a
 * broken environment, and a sentence nothing enforces is a suggestion.
 */

/**
 * What this unit is cleared to do, stated as actions. A list of paths says
 * where a worker may write; it never says what the plan expects to happen
 * there, and a worker that must create a file reads the same line as one
 * that must change an existing one (docs/WORDS.md).
 */
export function clearanceStanza(unit: { units?: unknown[] }): string {
  const cleared = (unit.units ?? []).flatMap(
    (w) => (w as { cleared?: { action: string; path: string }[] }).cleared ?? [],
  );
  if (!cleared.length) return "";
  const say = { create: "CREATE", change: "CHANGE", delete: "DELETE" } as Record<string, string>;
  return (
    "\n\n──── WHAT YOU ARE CLEARED TO DO ────\n" +
    cleared.map((c) => `- ${say[c.action] ?? c.action.toUpperCase()} ${c.path}`).join("\n") +
    "\nWriting anywhere else does not happen: the change is restored before your next step, so the " +
    "edit you believe you made is gone. This is the ORDER, not a refusal — every file here is " +
    "reachable, and the way to reach one is to ASK FIRST. Say which file you need and which " +
    "criterion requires it. The run rules on it and clears you, waiting if another unit is changing " +
    "that file at this moment; only then do you make the change yourself, in this session. Your " +
    "promise is never handed to another slice.\n" +
    "The list above is the plan's expectation and not a limit on your judgement about the work — " +
    "but judgement about WHERE to write is settled by asking, never by deciding."
  );
}

/** The stanza appended to a worker's brief when the oracle can answer. */
export function coderStanza(oracleAvailable: boolean): string {
  if (!oracleAvailable) return "";
  return (
    "\n\nYour completion is judged by `verify` going green, not by your claim. " +
    "Once this slice's checks are green, `verify` also runs the repository's own " +
    "standing checks on your tree and says which reds are yours: a red that is yours " +
    "is fixed in your files before you are done; one a maintainer brings under later, " +
    "or that waits on another unit's file, is named as not yours." +
    "\n\nHOW YOU ARE GRADED: on the committed base plus YOUR files only — another " +
    "unit's half-written work never enters your checks, and yours never enters " +
    "theirs. So a public signature you change must keep its existing callers " +
    "compiling (an overload, an optional parameter, a default): the callers " +
    "belong to other slices and are updated there. If the contract itself " +
    "requires breaking a signature, say so as UNDELIVERED with the callers named." +
    "\n\nThe tools you have are the ones you were given, no others. Never open, edit or " +
    "create a test or probe file, and never run a build, a test command or a package " +
    "manager — you have no shell. Work from the intent and the contract." +
    "\n\nIf a check is IMPOSSIBLE for any correct implementation, or plainly " +
    "misreads its criterion, do not grind against it: challenge it, in intent terms. " +
    "Granted, the check is re-authored from its criterion and the ruling is recorded on " +
    "the delivery; denied, meet it as it stands. A challenge is never a way to see the check."
  );
}

/** What every tester is told, whatever else its brief carries: a check
 *  observes the code at a seam and exits; it never acts on the world. */
export function testerStanza(built: readonly string[] = []): string {
  return (
    "EVERY TEST STANDS ALONE. Two tests in one file share the same loaded module: a value it " +
    "caches on first use (a singleton, a client, a bar) is created under the FIRST test's fakes " +
    "and every later test inherits it — so a later test that installs fresh fakes and asserts on " +
    "them reads an object nothing wrote to, and NO correct implementation can pass it. Install " +
    "your fakes FIRST, then load the module FRESH inside each test (a new module registry, a " +
    "cache-busting import, or one scenario per file). Never make production export a reset that " +
    "exists only for a test." +
    (built.length
      ? `\n\nWHERE THE BUILD EMITS: compiled output of this repository's build step lands in ${built.join(", ")}. ` +
        "A probe that imports compiled modules imports them from there — never from a folder the build does not write." + ""
      : "") +
    "\n\nHOW A CHECK MAY BEHAVE: a check OBSERVES the code at a seam — a call " +
    "made, a request built, a state changed inside the program — through a fake " +
    "where the real thing is the cluster this runs in, a service, a process, or " +
    "anything outside the repository. It NEVER performs the effect. It starts " +
    "nothing it does not stop: when a check has to start the program (its " +
    "activate, its server, its watchers), it stops it before it ends, so the " +
    "process EXITS on its own. A check that does not exit is a defective check " +
    "and counts as failed. A criterion that IS an effect on the world is not " +
    "yours to prove — the delivery reports it as not verified, with its reason."
  );
}
