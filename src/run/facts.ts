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
      ...(Array.isArray(parsed.builds)
        ? { builds: parsed.builds.filter((x) => typeof x === "string") }
        : {}),
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
export function factsAfterRun(
  known: RepositoryFacts | undefined,
  proved: { provision: string; prepare: string; runOne: string; build?: string; built: readonly string[] },
): RepositoryFacts {
  return {
    provision: proved.provision,
    prepare: proved.prepare,
    runOne: proved.runOne,
    ...(proved.build ? { build: proved.build } : {}),
    ...(proved.built.length
      ? { builds: [...proved.built] }
      : known?.builds?.length
        ? { builds: known.builds }
        : {}),
  };
}

/** Is there anything here worth writing down? */
export function worthRemembering(f: RepositoryFacts): boolean {
  return !!(f.provision || f.prepare || f.runOne || f.build || f.builds?.length);
}
