/**
 * Run a signed cut without the editor.
 *
 * Everything the run needs is a library: the space is folded from records
 * on disk, the repository's setup facts are read from the repository, and
 * the dispatcher is a function. Only the surface needed a window. Without
 * this entry point the machine can only be exercised by a person clicking,
 * which is why every iteration cost an hour of somebody's attention and why
 * nothing could be measured twice under the same conditions.
 *
 *   node out/cli/headless.js --space <space dir> --repo <repo> [--cut <id>]
 *                            [--suite "npm test"] [--prepare "npx tsc -p ."]
 *                            [--model sonnet] [--no-digest]
 *
 * It prints the run's log as it happens and ends with the delivery's
 * verdict; the exit code is 0 for a delivery, 1 for anything else.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { loadFolded } from "../core/records";
import { RunState } from "../run/state";
import { dispatchTep } from "../run/dispatch";
import { tepSlices } from "../dispatch/adapter";
import { planScopes } from "../dispatch/scopes";
import { knowledgeOf } from "../derive/knowledge";
import { factsOf } from "../run/facts";
import type { Cut, Space } from "../core/schema";

interface Args {
  space: string;
  repo: string;
  cut?: string;
  suite: string[];
  prepare?: string;
  provision?: string;
  model: string;
  digest: boolean;
  maxRunMs?: number;
}

export function parseArgs(argv: readonly string[]): Args | string {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const space = get("space");
  const repo = get("repo");
  if (!space || !repo)
    return "usage: --space <space dir> --repo <repo dir> [--cut <id>] [--suite <cmd>] [--prepare <cmd>] [--provision <cmd>] [--model <name>] [--hours <n>] [--no-digest]";
  const suite = (get("suite") ?? "npm test").split(" ").filter(Boolean);
  return {
    space: path.resolve(space),
    repo: path.resolve(repo),
    ...(get("cut") ? { cut: get("cut")! } : {}),
    suite,
    ...(get("prepare") ? { prepare: get("prepare")! } : {}),
    ...(get("provision") ? { provision: get("provision")! } : {}),
    ...(get("hours") ? { maxRunMs: Math.round(Number(get("hours")) * 3_600_000) } : {}),
    model: get("model") ?? "sonnet",
    digest: !argv.includes("--no-digest"),
  };
}

/** The cut to run: the one named, or the newest signed one. */
export function chooseCut(space: Space, id?: string): Cut | string {
  const signed = space.cuts.filter((c) => c.signature);
  if (!signed.length) return "no signed cut in this space";
  if (!id) return signed[signed.length - 1];
  const found = signed.find((c) => c.id === id || c.tepId === id);
  return found ?? `no signed cut named ${id} (have: ${signed.map((c) => c.tepId ?? c.id).join(", ")})`;
}

/** A file-backed store for the repository reading, keyed by the tree's stamp. */
function digestStore(dir: string): { load: (k: string) => string | undefined; save: (k: string, t: string) => void } {
  const file = path.join(dir, "knowledge.json");
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  return {
    load: (k) => read()[k],
    save: (k, t) => {
      const all = read();
      all[k] = t;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all, null, 2));
    },
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    process.stdout.write(`${args}\n`);
    return 2;
  }
  const author = process.env.TANDEM_AUTHOR ?? "headless";
  const { space } = loadFolded(args.space, args.space, author, () => new Date().toISOString());
  const cut = chooseCut(space, args.cut);
  if (typeof cut === "string") {
    process.stdout.write(`${cut}\n`);
    return 2;
  }
  // The same planner the editor uses: a cut is grouped by the repository
  // each promise lands in, and a promise that mixes two is refused here
  // exactly as it is refused there — never differently because the run was
  // started without a window.
  const plan = planScopes(space, cut);
  if (!plan.ok) {
    process.stdout.write(`${plan.reason}\n`);
    return 2;
  }
  const others = plan.order.filter((sc) => sc !== "");
  process.stdout.write(`running ${cut.tepId ?? cut.id} from ${args.space} over ${args.repo}\n`);
  if (others.length)
    process.stdout.write(
      `this cut also lands in ${others.join(", ")}, which this entry cannot reach: it runs one repository, the one given by --repo. ` +
        `Those promises are not run.\n`,
    );

  const st = new RunState(() => {});
  // The run replaces the sink with its own on-disk log, so chain rather
  // than assign: a headless run that prints nothing is a run nobody can
  // watch, which is the whole point of this entry.
  const toStdout = (line: string, step: string): void => {
    process.stdout.write(`${new Date().toISOString()} [${step}] ${line}\n`);
  };
  st.sink = toStdout;
  const chain = (): void => {
    const theirs = st.sink;
    if (theirs === toStdout) return;
    st.sink = (line, step) => {
      theirs?.(line, step);
      toStdout(line, step);
    };
  };
  setTimeout(chain, 2000).unref();

  // The repository's own facts, if it has already told a run: no flag, no
  // reading, no model call. A repository that has never been run against
  // falls through to the reading below.
  const told = factsOf(args.repo);
  if (told)
    process.stdout.write(
      `the repository's own setup facts, proved ${told.provenAt ?? "earlier"}: ` +
        `install ${told.provision || "NONE"}; build ${told.prepare || "NONE"}; one test ${told.runOne || "NONE"}\n`,
    );

  // The repository's own facts: how it installs, builds and runs one test.
  // Fail-soft — a run must never refuse because the reading was unavailable.
  const known = args.digest
    ? await knowledgeOf({
        deps: { model: args.model, repoRoot: args.repo, log: (l) => st.log(l, "knowledge") },
        cacheRoot: path.join(args.space, "graphs"),
        decisions: [],
        store: digestStore(args.space),
      }).catch((e: unknown) => {
        st.log(`the repository reading was unavailable: ${e instanceof Error ? e.message : String(e)}`, "knowledge");
        return undefined;
      })
    : undefined;

  const outcome = await dispatchTep(
    {
      repoRoot: args.repo,
      model: args.model,
      suiteCommand: args.suite,
      state: st,
      spaceName: path.basename(args.space),
      ...(args.maxRunMs ? { maxRunMs: args.maxRunMs } : {}),
      storeDir: args.space,
      ...(known?.digest ? { digest: known.digest } : {}),
      ...(known?.graph?.graphPath ? { graphPath: known.graph.graphPath } : {}),
      ...(args.prepare ?? told?.prepare ?? known?.prepare
        ? { prepare: args.prepare ?? told?.prepare ?? known!.prepare }
        : {}),
      ...(args.provision ?? told?.provision ?? known?.provision
        ? { provision: args.provision ?? told?.provision ?? known!.provision }
        : {}),
      ...(told?.runOne ?? known?.runOne ? { runOne: told?.runOne ?? known!.runOne } : {}),
      ...(known ? { affected: (p: string) => known.affected(p) } : {}),
    },
    space,
    cut,
    tepSlices({ space, cut, spaceName: path.basename(args.space) }),
  );

  const d = outcome.delivery;
  process.stdout.write(
    `\n── ${cut.tepId ?? cut.id} ──\n` +
      (d?.withheld
        ? `withheld: ${d.withheld}\n`
        : d
          ? `delivered${d.url ? `: ${d.url}` : " (no forge configured — the branch holds the work)"}\n` +
            `proofs: ${d.proofs.filter((p) => p.verdict === "green").length} green, ${d.proofs.filter((p) => p.verdict !== "green").length} not\n` +
            d.proofs.filter((p) => p.verdict !== "green").map((p) => `  ✗ ${p.label}\n`).join("")
          : `no delivery\n`) +
      (outcome.refusals.length ? `refused: ${outcome.refusals.join("; ")}\n` : "") +
      (outcome.undelivered.length ? `undelivered:\n${outcome.undelivered.map((u) => `  - ${u}`).join("\n")}\n` : ""),
  );
  return d && !d.withheld ? 0 : 1;
}

if (require.main === module)
  void main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      process.exit(1);
    },
  );
