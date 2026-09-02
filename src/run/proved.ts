/**
 * A command that was RUN here before it was believed.
 *
 * Five commands are everything a run knows about the repository it judges:
 * how it installs, how it builds so a check can run, how it runs one
 * check, how it builds the product, how it runs its whole suite. Each is a
 * fact about somebody else's repository, and this codebase has invented
 * every one of them at least once — `node --test <file>` for a check,
 * `npm test` for a suite, `node_modules` for a dependency store. In a
 * repository that is not JavaScript the invented command does not run, the
 * shell says so, and the run reports that sentence as a verdict about the
 * work. Silent, and wrong in the direction that blames the person.
 *
 * Reading the code for those finds the ones somebody thought of. This type
 * finds all of them: a plain string is not assignable to `Proved`, so
 * every invented command is a compile error — including the ones nobody
 * has written yet.
 *
 * The only way to mint one is {@link proved}, called where a command has
 * just been executed and answered. A cast defeats it; `as Proved` is the
 * one thing to watch, and it is a single grep.
 */

/** A command this run executed here and saw answer. */
export type Proved = string & { readonly ranHere: unique symbol };

/**
 * Mint one, at the site that ran the command and read its answer.
 *
 * `ran` is that site's own reading of "a runner answered" — an exit code,
 * the runner's own words, whatever answering means for this command. False
 * mints nothing: a command that did not answer is not a way to do
 * anything, and the caller must say so rather than carry it on.
 */
export function proved(command: string, ran: boolean): Proved | undefined {
  const cmd = command.trim();
  return ran && cmd ? (cmd as Proved) : undefined;
}

/**
 * The one sanctioned deferral of proof.
 *
 * A repository with no tests cannot prove its single-check command — the
 * command runs a test, and no test exists until the tester writes the
 * first one. Refusing to start is a chicken-and-egg: no tests, so no run,
 * so no tests. So the told command is carried, SAID to be unproven, and
 * proves itself in use the moment the first written check runs. A
 * candidate that cannot run yields "could not be judged" there — never a
 * verdict against the work — which is what makes this deferral safe.
 */
export function provisional(
  command: string,
  why: string,
  log?: (line: string) => void,
): Proved {
  const cmd = command.trim();
  log?.(`carrying "${cmd}" unproven: ${why}`);
  return cmd as Proved;
}

/**
 * What the run knows about this repository, and what it does not.
 *
 * One vocabulary for all five, so a missing fact is reported the same way
 * wherever it is missing: which fact, what it is for, and where it comes
 * from. Before this, an absent command was a different silence at each
 * consumer — a skipped veto, an unrun check, an empty string handed to a
 * shell — and each had to be diagnosed from scratch.
 */
interface RepositoryFact {
  /** The name a person can act on: "suite", "runOne", "build". */
  name: "provision" | "prepare" | "runOne" | "build" | "suite";
  /** What the run cannot do without it, in one sentence. */
  needed: string;
}

const FACTS: readonly RepositoryFact[] = [
  { name: "provision", needed: "install this repository's dependencies in a fresh worktree" },
  { name: "prepare", needed: "build this repository so one of its checks can run" },
  { name: "runOne", needed: "run one check and read its verdict — the promise veto rests on it" },
  { name: "build", needed: "build the product as shipped — the second veto rests on it" },
  { name: "suite", needed: "run the whole suite on the delivered tree — the closing judgement is its verdict" },
];

/**
 * How a missing fact is said, everywhere it is missing.
 *
 * A run that cannot get one of these cannot judge, and the person reading
 * the refusal needs three things to act: which fact, what it was for, and
 * where the run looks for it. Every consumer used to invent its own
 * wording, or say nothing at all.
 */
export function missing(name: RepositoryFact["name"]): string {
  const f = FACTS.find((x) => x.name === name);
  return (
    `this run has no proved way to ${f?.needed ?? name} for this repository. ` +
    `It is read from the repository itself, proved by running it, and remembered in ` +
    `.tandem/setup.json under "${name}" — record it there, or let the run read the ` +
    `repository again.`
  );
}

/**
 * The single-check command for whichever part owns a file.
 *
 * The deepest part whose root contains the check wins, so a check under
 * `frontend/` is run by the frontend's runner even when the repository has
 * one of its own. A part with no command of its own falls back to the
 * repository's — the single-toolchain case, unchanged.
 *
 * A part's command is written for the part's own tree: `<file>` is the
 * path as that part's runner takes it, and the command runs where that
 * part is. That is how the door proved it, so that is how every check
 * runs it — from the repository root, the runner finds no configuration
 * and the path names nothing.
 */
export function runnerFor(
  wide: Proved,
  parts: Record<string, { runOne?: string }> = {},
): (checkPath: string) => Proved {
  const owned = Object.entries(parts)
    .filter(([root, p]) => root !== "." && p.runOne)
    .sort(([a], [b]) => b.length - a.length);
  return (checkPath) => {
    const hit = owned.find(([root]) => checkPath === root || checkPath.startsWith(`${root}/`));
    if (!hit) return wide;
    const [root, part] = hit;
    const inPart = checkPath === root ? "." : checkPath.slice(root.length + 1);
    const cmd = (part.runOne as string).replace(/<file>/g, inPart).trim().replace(/;+$/, "");
    return `cd ${root} && { ${cmd}; }` as Proved;
  };
}
