/**
 * The code graph: a deterministic structural map of the repository, built
 * by graphify (tree-sitter, no model, local) and cached under the
 * repository's stamp.
 *
 * It answers the questions a model should never be asked to answer by
 * searching: what is here, what calls what, and what else moves when this
 * moves. Those are facts, they are free, and they come back in
 * milliseconds with a file and a line on every one of them.
 *
 * IT IS REQUIRED, NOT PREFERRED. A missing binary or a failed build
 * refuses the derivation and says so. Deriving from a worse picture,
 * quietly, is how a machine produces confident work about code it never
 * read — and the human cannot tell the difference from the outside.
 *
 * graphify insists on writing `<root>/graphify-out/`, so the build is
 * build-then-move: the transient directory is git-excluded so it can
 * never poison a dirty-tree stamp, the graph is copied into the cache,
 * and the directory is removed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { readStamp, SourceStamp, stampsEqual } from "../core/stamp";

const run = promisify(execFile);

export function graphifyBin(): string {
  return process.env.THINKUBE_GRAPHIFY_BIN?.trim() || "graphify";
}

/** Why the machine will not derive. Carries what to do about it. */
export class NoCodeGraph extends Error {
  constructor(why: string) {
    super(
      `${why} — the code graph is how this reads your repository, and it will not derive ` +
        `from a worse picture. Install it with \`uv tool install graphifyy\`, or point ` +
        `THINKUBE_GRAPHIFY_BIN at the binary.`,
    );
    this.name = "NoCodeGraph";
  }
}

let probed: string | undefined;
/** One probe per host process — a missing binary costs one spawn. */
async function version(): Promise<string> {
  if (probed !== undefined) return probed;
  try {
    const { stdout } = await run(graphifyBin(), ["--version"], { timeout: 15_000 });
    probed = stdout.trim();
  } catch (err) {
    throw new NoCodeGraph(
      `graphify is not runnable (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  return probed;
}

/** For tests. */
export function resetGraphProbe(): void {
  probed = undefined;
}

const cacheDirFor = (cacheRoot: string, repoRoot: string): string =>
  path.join(cacheRoot, "graphs", createHash("sha256").update(repoRoot).digest("hex").slice(0, 16));

/** Keep the transient build directory out of porcelain forever. */
function excludeBuildDir(repoRoot: string): void {
  try {
    const exclude = path.join(repoRoot, ".git", "info", "exclude");
    if (!fs.existsSync(path.dirname(exclude))) return;
    const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
    if (!cur.split("\n").includes("graphify-out/"))
      fs.writeFileSync(exclude, `${cur.trimEnd()}\ngraphify-out/\n`);
  } catch {
    /* cosmetic: a failed exclude only risks a noisier stamp */
  }
}

export interface CodeGraph {
  graphPath: string;
  stamp: SourceStamp;
}

/**
 * The graph for this repository as it is right now, rebuilt only when the
 * code moved under it. The stamp carries HEAD and a digest of the dirty
 * tree, so uncommitted work counts — a graph that ignores what you have
 * not committed is a map of a repository nobody has.
 *
 * Rebuilding is forced: graphify keeps the larger graph by default, so
 * after deletions an unforced rebuild would keep describing code that is
 * gone.
 */
export async function ensureCodeGraph(args: {
  repoRoot: string;
  cacheRoot: string;
  log?: (line: string) => void;
}): Promise<CodeGraph> {
  await version();
  const stamp = await readStamp(args.repoRoot);
  if (!stamp.head) throw new NoCodeGraph(`${args.repoRoot} is not a git repository`);
  const dir = cacheDirFor(args.cacheRoot, args.repoRoot);
  const graphPath = path.join(dir, "graph.json");
  const stampPath = path.join(dir, "stamp.json");
  try {
    const prior = JSON.parse(fs.readFileSync(stampPath, "utf8")) as SourceStamp;
    if (stampsEqual([prior], [stamp]) && fs.existsSync(graphPath)) return { graphPath, stamp };
  } catch {
    /* no usable prior — build */
  }
  const built = path.join(args.repoRoot, "graphify-out", "graph.json");
  try {
    excludeBuildDir(args.repoRoot);
    args.log?.("▸ mapping your code — deterministic, no model, no tokens");
    await run(graphifyBin(), ["update", args.repoRoot, "--force"], {
      timeout: 10 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(built, graphPath);
    fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2));
    return { graphPath, stamp };
  } catch (err) {
    throw new NoCodeGraph(
      `the code graph could not be built for ${args.repoRoot}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    fs.rmSync(path.join(args.repoRoot, "graphify-out"), { recursive: true, force: true });
  }
}

/** One bounded question of the graph. Empty when it knows nothing. */
export async function askGraph(args: {
  graphPath: string;
  question: string;
  budget?: number;
}): Promise<string> {
  const { stdout } = await run(
    graphifyBin(),
    ["query", args.question, "--graph", args.graphPath, "--budget", String(args.budget ?? 900)],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim();
}

/**
 * What else moves when this moves: every caller, importer and referencer,
 * with the file and line of each.
 *
 * This is the completeness round's own question, and the graph answers it
 * in a quarter of a second — where a round with grep spends minutes
 * looking for the same thing and can only report what it happened to
 * find.
 */
export async function affectedBy(args: {
  graphPath: string;
  node: string;
  depth?: number;
}): Promise<string> {
  try {
    const { stdout } = await run(
      graphifyBin(),
      ["affected", args.node, "--graph", args.graphPath, "--depth", String(args.depth ?? 2)],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    // A name the graph does not hold is not a failure of the graph.
    return "";
  }
}

/** The architectural hubs: what most of this repository hangs off. */
export async function hubs(graphPath: string, top = 12): Promise<string> {
  const { stdout } = await run(
    graphifyBin(),
    ["god-nodes", "--graph", graphPath, "--top", String(top)],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim();
}

/**
 * Several questions, one answer. graphify picks start nodes by keyword,
 * so one intent-shaped question under-retrieves; a small plan of concrete
 * questions retrieves what one cannot, and repeated lines are dropped so
 * shared subgraphs are not paid for twice.
 */
export async function askPlan(args: {
  graphPath: string;
  questions: readonly string[];
  budgetPerQuestion?: number;
}): Promise<string> {
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const q of args.questions.slice(0, 8)) {
    const out = await askGraph({
      graphPath: args.graphPath,
      question: q,
      budget: args.budgetPerQuestion ?? 900,
    }).catch(() => "");
    if (!out) continue;
    const fresh = out
      .split("\n")
      .filter((l) => !l.trim() || !seen.has(l.trim()))
      .join("\n")
      .trim();
    for (const l of out.split("\n")) if (l.trim()) seen.add(l.trim());
    if (fresh) sections.push(`### ${q}\n${fresh}`);
  }
  return sections.join("\n\n");
}
