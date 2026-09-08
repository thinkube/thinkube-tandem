/**
 * Defects in the tool itself, recorded where every other defect is.
 *
 * The ledger records what a RUN catches, and a run cannot catch a defect
 * in the machinery that runs it. So the population the methodology most
 * needs to watch — Tandem's own reliability — was the one population it
 * could not see: hundreds of repairs to the extension in the same period
 * left almost no trace, while the work Tandem supervised was fully
 * instrumented.
 *
 * A repair to the tool is a commit. So the commit is where it is said:
 * a line beginning `Defect:` in the message names what was wrong, and
 * every deploy harvests the ones it has not harvested yet. Nothing is
 * inferred from a commit that does not say so — silence records nothing
 * rather than guessing, because a ledger read monthly is worth less than
 * nothing if it is full of guesses.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { appendDefect, ledgerRoot, type DefectEntry } from "./defectLog";

/** The line that names a defect this commit repaired. */
const TRAILER = /^\s*Defect:\s*(.+?)\s*$/i;

/** Where the last harvested commit is remembered, beside the ledger. */
export function harvestMarkPath(storeDir: string): string {
  return path.join(ledgerRoot(storeDir).root, "defects", ".self-harvested");
}

/** One repair, as the commit that made it described it. */
export interface SelfDefect {
  sha: string;
  at: string;
  subject: string;
  /** What was wrong, in the commit's own words. */
  said: string;
}

/** The `Defect:` lines in one commit message, with nothing invented. */
export function defectsIn(message: string): string[] {
  return message
    .split(/\r?\n/)
    .map((l) => TRAILER.exec(l)?.[1])
    .filter((x): x is string => !!x && !/^none$/i.test(x));
}

/**
 * The repairs recorded since a commit, newest last.
 *
 * `since` absent reads the whole history, which is what a first harvest
 * does; a sha no longer in the history reads the whole history too,
 * rather than failing on a rebase.
 */
export function selfDefectsSince(
  repoRoot: string,
  since?: string,
  run: (args: string[]) => string = (args) =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
): SelfDefect[] {
  const SEP = "\x1e";
  const range = since ? [`${since}..HEAD`] : [];
  let out = "";
  try {
    out = run(["log", "--reverse", `--format=%x1e%H%x1f%aI%x1f%s%x1f%B`, ...range]);
  } catch {
    try {
      out = run(["log", "--reverse", `--format=%x1e%H%x1f%aI%x1f%s%x1f%B`]);
    } catch {
      return [];
    }
  }
  const found: SelfDefect[] = [];
  for (const chunk of out.split(SEP)) {
    if (!chunk.trim()) continue;
    const [sha, at, subject, body = ""] = chunk.split("\x1f");
    for (const said of defectsIn(body)) found.push({ sha, at, subject, said });
  }
  return found;
}

/** The head this harvest ran against, remembered for the next one. */
function headOf(
  repoRoot: string,
  run: (args: string[]) => string = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }),
): string | undefined {
  try {
    return run(["rev-parse", "HEAD"]).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** One repair as a ledger row: the tool's own, never a space's. */
export function rowFor(d: SelfDefect, version?: string): DefectEntry {
  return {
    ts: d.at,
    spec: "thinkube-tandem",
    activity: "tool development",
    trigger: "self-repair",
    // The tool was wrong. Typed as the machine's own so a monthly reading
    // can separate the work Tandem supervises from Tandem itself.
    type: "machine",
    impact: "the tool was wrong and was repaired",
    detail: `${d.said}\n— ${d.subject}`.slice(0, 1200),
    ...(version ? { version } : {}),
    refs: [d.sha],
  };
}

/**
 * Harvest every repair not yet recorded, and remember where we got to.
 *
 * Safe to run on every deploy: the mark makes it idempotent, and a failed
 * write leaves the mark untouched so the next deploy tries again.
 */
export function harvestSelfDefects(a: {
  repoRoot: string;
  storeDir: string;
  version?: string;
  /** Injectable for tests. */
  git?: (args: string[]) => string;
}): { recorded: number; head?: string } {
  const mark = harvestMarkPath(a.storeDir);
  const since = ((): string | undefined => {
    try {
      return fs.readFileSync(mark, "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  })();
  const found = a.git ? selfDefectsSince(a.repoRoot, since, a.git) : selfDefectsSince(a.repoRoot, since);
  let recorded = 0;
  for (const d of found) if (appendDefect(a.storeDir, rowFor(d, a.version))) recorded++;
  const head = a.git ? headOf(a.repoRoot, a.git) : headOf(a.repoRoot);
  if (head) {
    try {
      fs.mkdirSync(path.dirname(mark), { recursive: true });
      fs.writeFileSync(mark, `${head}\n`, "utf8");
    } catch {
      /* the next deploy harvests the same range again rather than losing it */
    }
  }
  return { recorded, ...(head ? { head } : {}) };
}
