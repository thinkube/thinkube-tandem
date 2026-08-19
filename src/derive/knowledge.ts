/**
 * What is known, carried through every step.
 *
 * The principle this product is built on is that knowledge is shared and
 * spread across the whole process — and it was not enforced anywhere.
 * Each round took its own argument list, so whether a step knew what the
 * step before it had learned depended on somebody remembering to thread a
 * parameter. Three of them did not: the reading that decides what your
 * asks are ABOUT had never seen a line of your code, the completeness
 * round searched the repository from cold with a reading of it sitting in
 * the store, and the workers received none of it at all.
 *
 * So there is one thing that carries it, built once per derivation and
 * taken by every step. A step that is not fed does not compile.
 *
 * The map is deterministic and comes from the code itself. The digest is
 * a reading ON TOP of it — what a structural map cannot see: conventions,
 * and the reasons written in comments. Neither replaces the other, and
 * neither is optional: without the map the machine would be deriving from
 * a guess about a repository it never read, and it refuses instead.
 */
import { affectedBy, askGraph, askPlan, CodeGraph, ensureCodeGraph, hubs } from "./graph";
import { enrichAffected } from "./spans";
import { runContextualize } from "./contextualize";
import { deriveSetup, NO_SETUP, Setup } from "./prepare";
import { RoundDeps, runReadRound } from "./round";

export interface Knowledge {
  /** The repository this is knowledge OF. */
  repoRoot: string;
  /** The deterministic map, and the state of the code it describes. */
  graph: CodeGraph;
  /** Structure, from the code: hubs, layout, what hangs off what. */
  map: string;
  /** Conventions and rationale, read on top of the map. */
  digest: string;
  /** What a fresh checkout needs installed before anything resolves —
   *  read from the repository's own manifests, empty when a checkout is
   *  already complete. Nobody types this into a setting. */
  provision: string;
  /** The command a single check needs before it can execute (a compile,
   *  a codegen) — read the same way, empty when tests run from source. */
  prepare: string;
  /** Re-read both facts with the evidence of a setup that failed on a fresh
   *  checkout; the corrected answer is remembered. */
  /** How one of the repository's own tests runs (`<file>` = its path), unproven until the door proves it. */
  runOne: string;
  /** Test files red at an earlier gate of this repository. */
  suiteReds: string[];
  rememberSuiteReds: (files: readonly string[]) => void;
  resetup: (evidence: string) => Promise<{ provision: string; prepare: string; runOne: string }>;
  /** The door proved this answer on a fresh checkout — remember it as such. */
  proveSetup: (s: { provision: string; prepare: string; runOne: string }) => void;
  /** What the human has settled — every derivation runs under these. */
  decisions: readonly string[];
  /** A bounded question of the graph: cited nodes, in milliseconds. */
  ask: (question: string, budget?: number) => Promise<string>;
  /** What else moves when this moves — each entry carrying the source
   *  line it names, quoted, so the receiver judges instead of re-reading.
   *  A pointer without its line is homework, not knowledge. */
  affected: (node: string) => Promise<string>;
}

/** The questions the structural reading is assembled from. */
const LAYOUT_QUESTIONS = [
  "what are the entry points and the top level modules",
  "where is state held and how does it flow",
  "how are tests laid out and what do they cover",
];

/**
 * Assemble what is known about a repository, once.
 *
 * The map costs no tokens and a few seconds; the digest costs one cheap
 * round and is cached under the same stamp, so a second derivation over
 * unchanged code pays for neither.
 */
export async function knowledgeOf(args: {
  deps: RoundDeps;
  cacheRoot: string;
  decisions: readonly string[];
  /** Where the digest is kept, keyed by the graph's own stamp. */
  store?: { load: (key: string) => string | undefined; save: (key: string, text: string) => void };
  round?: typeof runReadRound;
}): Promise<Knowledge> {
  const log = args.deps.log ?? (() => {});
  const graph = await ensureCodeGraph({
    repoRoot: args.deps.repoRoot,
    cacheRoot: args.cacheRoot,
    log,
  });

  const map = [
    await hubs(graph.graphPath).catch(() => ""),
    await askPlan({ graphPath: graph.graphPath, questions: LAYOUT_QUESTIONS }),
  ]
    .filter(Boolean)
    .join("\n\n");

  const stampKey = `${graph.stamp.head}${graph.stamp.dirty ? `+${graph.stamp.dirty}` : ""}`;
  const key = `digest@${stampKey}`;
  let digest = args.store?.load(key) ?? "";
  if (!digest) {
    log("▸ reading what the map cannot show — conventions, and the why");
    digest = (await runContextualize(args.deps, args.round, map)) ?? "";
    if (digest) args.store?.save(key, digest);
  }

  // The check-setup facts are facts about the repository; the machine
  // reads them once per state. "NONE" is cached too — the common answer
  // must not be re-asked on every derivation.
  // The answer is anchored on the last one given: a fact about the
  // repository must not flip between two readings of unchanged manifests.
  const setupKey = `setup@${stampKey}`;
  const parseReds = (raw: string | undefined): string[] => {
    try {
      const v = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const parseSetupJson = (raw: string | undefined): Setup | undefined => {
    if (raw === undefined) return undefined;
    try {
      return { ...NO_SETUP, ...(JSON.parse(raw) as Partial<Setup>) };
    } catch {
      return { ...NO_SETUP };
    }
  };
  // "setup@proven" is an answer the door has PROVED on a fresh checkout;
  // a fresh reading never overwrites it — only the door does, by proving
  // the next answer. A reading that produced nothing is not an answer.
  const proven = parseSetupJson(args.store?.load("setup@proven"));
  let setup = parseSetupJson(args.store?.load(setupKey));
  if (!setup) {
    log("▸ asking the repository how a fresh checkout is made ready and how a single check runs");
    setup =
      (await deriveSetup(args.deps, args.round, map, digest, proven ? { previous: proven } : {})) ??
      proven ??
      { ...NO_SETUP };
    args.store?.save(setupKey, JSON.stringify(setup));
  }
  const settled: Setup = setup;

  return {
    repoRoot: args.deps.repoRoot,
    graph,
    map,
    digest,
    provision: settled.provision,
    prepare: settled.prepare,
    runOne: settled.runOne,
    suiteReds: parseReds(args.store?.load("suite@reds")),
    rememberSuiteReds: (files) => {
      const all = [...new Set([...parseReds(args.store?.load("suite@reds")), ...files])].slice(-40);
      args.store?.save("suite@reds", JSON.stringify(all));
    },
    // A setup that failed on a fresh checkout is re-read with the failure as
    // evidence; the corrected answer replaces the remembered one.
    resetup: async (evidence) => {
      log("▸ the setup failed on a fresh checkout — asking the repository again, with the failure");
      const again = await deriveSetup(args.deps, args.round, map, digest, {
        failed: { setup: settled, evidence },
        ...(proven ? { previous: proven } : {}),
      });
      // The door decides what to remember: a corrected answer is written
      // as proven only once it held there.
      return again ?? proven ?? settled;
    },
    proveSetup: (s) => {
      args.store?.save("setup@proven", JSON.stringify(s));
      args.store?.save(setupKey, JSON.stringify(s));
    },
    decisions: args.decisions,
    ask: (question, budget) => askGraph({ graphPath: graph.graphPath, question, budget }),
    affected: (node) =>
      affectedBy({ graphPath: graph.graphPath, node }).then((t) =>
        enrichAffected(args.deps.repoRoot, t),
      ),
  };
}
