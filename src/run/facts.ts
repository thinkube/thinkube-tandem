/**
 * The four facts about a repository, kept in the repository.
 *
 * How it installs, how it builds, how one of its own tests runs: these are
 * facts about the code, not about whoever last worked on it. Keeping them
 * in the editor's cache meant a run started without a window had to be
 * TOLD them on the command line — the same repository, read twice, once
 * per surface — and a proved answer died with the cache it lived in.
 *
 * They live at `.tandem/setup.json` in the repository, written the moment
 * the door PROVES an answer on an untouched checkout, and read by anything
 * that needs them. A repository that has never been run against has no
 * file, and the reading happens as before.
 *
 * Never a configuration a person maintains: nothing writes here but a
 * proof, and a wrong file costs one run, after which the door proves the
 * corrected answer and overwrites it.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface RepositoryFacts {
  /** How a fresh checkout is made ready to build, or "". */
  provision: string;
  /** How it builds, or "". */
  prepare: string;
  /** How one of its own tests runs (`<file>` = its path), or "". */
  runOne: string;
  /** How the product is built to ship, or "". */
  build?: string;
  /**
   * How this repository runs its WHOLE suite, proved on an untouched tree.
   *
   * It was a default — `npm test` — in five places. A repository in any
   * other language got it regardless: the gate ran a command that could
   * not exist there and read "command not found" as the suite's verdict,
   * withholding the delivery and telling the person their standing checks
   * were red.
   */
  suite?: string;
  /**
   * What this repository's own build step PRODUCES — measured, never named.
   *
   * A run may share dependencies with the checkout it came from, but never
   * build output: output is the work being judged, and a run that borrows
   * it compiles through a doorway into the other tree and grades that
   * tree's code. It happened — seven reds against work that was finished.
   *
   * Telling the two apart used to be a list of ecosystem names, which is a
   * list of the ecosystems somebody thought of. The repository's own build
   * command says what it makes, in whatever language it is written in.
   */
  builds?: string[];
  /**
   * What this repository's INSTALL command was watched producing — the
   * ONLY thing a later run may borrow instead of installing again. Absent
   * means nothing is lent: one install, watched, is how the answer is
   * learned in the first place.
   */
  dependencies?: string[];
  /**
   * What the merge sets in motion for this repository — one word, decided
   * by the survey from evidence (the remote, the manifests, the playbook
   * convention). Everything specific to that downstream lives in its own
   * authoritative source (`thinkube.yaml`, the component's playbooks) and
   * is read at the moment of use, never copied here.
   */
  downstream?: string;
  /** When the door proved these, so a reader can tell how old they are. */
  provenAt?: string;
}

const FILE = path.join(".tandem", "setup.json");

/** What this repository already told a run about itself, if anything. */
export function factsOf(repoRoot: string): RepositoryFacts | undefined {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<RepositoryFacts>;
    if (typeof parsed.provision !== "string" && typeof parsed.prepare !== "string") return undefined;
    return {
      provision: parsed.provision ?? "",
      prepare: parsed.prepare ?? "",
      runOne: parsed.runOne ?? "",
      ...(parsed.build ? { build: parsed.build } : {}),
      ...(typeof parsed.suite === "string" && parsed.suite.trim() ? { suite: parsed.suite } : {}),
      ...(Array.isArray(parsed.builds)
        ? { builds: parsed.builds.filter((x) => typeof x === "string") }
        : {}),
      ...(Array.isArray(parsed.dependencies)
        ? { dependencies: parsed.dependencies.filter((x) => typeof x === "string") }
        : {}),
      ...(typeof parsed.downstream === "string" ? { downstream: parsed.downstream } : {}),
      ...(parsed.provenAt ? { provenAt: parsed.provenAt } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Record what the door proved. Best-effort: a repository that cannot be
 * written to still runs — it simply asks again next time.
 */
export function rememberFacts(repoRoot: string, facts: RepositoryFacts, at: string): void {
  try {
    const dir = path.join(repoRoot, ".tandem");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "setup.json"),
      `${JSON.stringify({ ...facts, provenAt: at }, null, 2)}\n`,
    );
  } catch {
    /* the run does not depend on remembering */
  }
}

/**
 * What this run proved about the repository, folded onto what it already
 * knew. A run that borrowed installed nothing and measured no build, so it
 * has nothing new to say and the earlier answer stands.
 */
function factsAfterRun(
  known: RepositoryFacts | undefined,
  proved: {
    provision: string;
    prepare: string;
    runOne: string;
    build?: string;
    suite?: string;
    built: readonly string[];
    /** What the install was watched producing (or the borrow re-confirmed). */
    provisioned?: readonly string[];
    downstream?: string;
  },
): RepositoryFacts {
  return {
    provision: proved.provision,
    prepare: proved.prepare,
    runOne: proved.runOne,
    ...(proved.build ? { build: proved.build } : {}),
    ...(proved.suite ? { suite: proved.suite } : known?.suite ? { suite: known.suite } : {}),
    ...(proved.downstream
      ? { downstream: proved.downstream }
      : known?.downstream
        ? { downstream: known.downstream }
        : {}),
    ...(proved.provisioned?.length
      ? { dependencies: [...proved.provisioned] }
      : known?.dependencies?.length
        ? { dependencies: known.dependencies }
        : {}),
    ...(proved.built.length
      ? { builds: [...proved.built] }
      : known?.builds?.length
        ? { builds: known.builds }
        : {}),
  };
}

/** Is there anything here worth writing down? */
function worthRemembering(f: RepositoryFacts): boolean {
  return !!(f.provision || f.prepare || f.runOne || f.build || f.suite || f.builds?.length);
}

/**
 * Write down what held on the untouched tree, folded onto what the
 * repository already knew — so the next run, with a window or without one,
 * is told by the repository rather than by a person or a default.
 *
 * "Nothing needed", proved on a tree that already had its dependencies, is
 * not a fact about the repository: run 2 of the acceptance believed one
 * and died before its first test. Only an answer with content is kept.
 */
export function rememberWhatHeld(
  repoRoot: string,
  known: RepositoryFacts | undefined,
  ready: {
    runOne?: string;
    suite?: string;
    built: readonly string[];
    provisioned?: readonly string[];
    downstream?: string;
    corrected?: { provision: string; prepare: string };
  },
  told: { provision?: string; prepare?: string; build?: string },
  at: string,
): void {
  const facts = factsAfterRun(known, {
    ...(ready.provisioned ? { provisioned: ready.provisioned } : {}),
    ...(ready.downstream ? { downstream: ready.downstream } : {}),
    provision: ready.corrected?.provision ?? told.provision ?? "",
    prepare: ready.corrected?.prepare ?? told.prepare ?? "",
    runOne: ready.runOne ?? "",
    ...(told.build ? { build: told.build } : {}),
    ...(ready.suite ? { suite: ready.suite } : {}),
    built: ready.built,
  });
  if (worthRemembering(facts)) rememberFacts(repoRoot, facts, at);
}
