/**
 * The oracle's rounds, with the owner rule applied: a round's failures are
 * classified; the check-owned ones are repaired by the tester's re-author
 * and the round is run again; the reply the coder reads says what was
 * repaired and which failures are the environment's, not its own.
 */
import { formatVerifyReply, VerifyOracle, VerifyResult } from "../engine/verifyOracle";
import { type VerifyWithSuite } from "./suite";
import { uninformative, type Diagnoser } from "./diagnose";
import { failuresByOwner } from "./owner";

export type Repair = (slice: string, failures: { ac: number; evidence: string }[]) => Promise<string[]>;

/** Module specifiers a build or a run said it could not find. */
function missingModulesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/Cannot find module '([^']+)'/g)) out.add(m[1]);
  return [...out];
}

/** The path stem a specifier or a path denotes: no extension, no build
 *  output folder, no leading "./" — what two spellings of one module share. */
const stemOf = (p: string): string =>
  p
    .replace(/\\/g, "/")
    .replace(/^.*?\/(out-test|out|dist|build|lib)\//, "")
    .replace(/^\.\//, "")
    .replace(/\.[cm]?[jt]sx?$/, "")
    .replace(/\.d$/, "");

/**
 * "The tree is not ready": a missing module is a file another unit will
 * still create. Not this unit's failure, not the check's — the run waits
 * for the next commit. Returns the planned files it matched, or nothing.
 */
function treeNotReady(
  r: VerifyResult,
  pendingPlanned: readonly string[],
  errorFiles: readonly string[] = [],
): string[] {
  if (!pendingPlanned.length) return [];
  const texts =
    r.kind === "build-failed" ? [r.output] : r.kind === "results" ? r.results.filter((x) => !x.pass).map((x) => x.evidence) : [];
  const stems = pendingPlanned.map((p) => ({ path: p, stem: stemOf(p) }));
  const hits = new Set<string>();
  for (const t of texts)
    for (const spec of missingModulesIn(t)) {
      const candidates = spec.startsWith(".")
        ? [stemOf(spec.replace(/^\.\//, "")), ...errorFiles.map((f) => stemOf(f.replace(/[^/]*$/, "") + spec))]
        : [stemOf(spec)];
      for (const c of candidates)
        for (const s of stems) if (c && (s.stem === c || s.stem.endsWith("/" + c) || c.endsWith("/" + s.stem))) hits.add(s.path);
    }
  return [...hits];
}

/** One verify round for the coder, repaired once when a check could not run. */
export async function verifyWithRepair(args: {
  oracle: VerifyOracle;
  slice: string;
  repair: Repair;
  /** The judge that RUNS a check whose failure says nothing. */
  diagnose?: Diagnoser;
  halted?: () => boolean;
  /** The acting unit's footprint — a build that fails only outside it is not its failure. */
  footprint?: readonly string[];
  /** Files other units will still create — a build missing one is the tree, not this unit. */
  pendingPlanned?: () => readonly string[];
}): Promise<string> {
  let r = await args.oracle.verify();
  const notes: string[] = [];
  const planned = treeNotReady(r, args.pendingPlanned?.() ?? [], r.kind === "build-failed" ? r.errorFiles : []);
  if (planned.length)
    return [
      formatVerifyReply(r),
      "──── THE TREE IS NOT READY (not your code, not the checks) ────",
      `A module the build could not find is a file another unit will still create: ${planned.join(", ")}. Do not change your files for this; verify again in a moment.`,
    ].join("\n\n");
  if (r.kind === "build-failed" && args.footprint) {
    const mine = args.footprint;
    const outside = r.errorFiles.filter((f) => !mine.some((m) => f === m || f.startsWith(m + "/")));
    if (outside.length && outside.length === r.errorFiles.length)
      notes.push(
        "──── ENVIRONMENT (not your code) ────",
        `The build fails only in files you are not cleared for: ${outside.join(", ")}. Another unit's work, or the committed base, does not compile right now. Do not change your files for this; verify again in a moment.`,
      );
  }
  const repaired = await repairChecks(args, r);
  if (repaired.length && !args.halted?.()) {
    r = await args.oracle.verify();
    notes.push(
      "──── CHECKS REPAIRED (they could not run — the tester re-wrote them from their criteria; the round was run again) ────",
      ...repaired.map((x) => `- ${x}`),
    );
  }
  const env = failuresByOwner(r).filter((f) => f.owner === "environment");
  if (env.length)
    notes.push(
      "──── ENVIRONMENT (not your code: the runner could not build or a tool was missing) ────",
      ...env.map((f) => `- check ${f.ac}: ${f.evidence.split("\n").slice(1, 3).join(" ").trim().slice(0, 200)}`),
    );
  // A failure a coder cannot act on is never handed back as-is: the judge
  // runs the check, looks, and either re-authors it or says what to build.
  if (args.diagnose && r.kind === "results")
    for (const f of r.results.filter((x) => !x.pass && uninformative(x.evidence))) {
      const d = await args.diagnose(args.slice, f.ac, f.evidence);
      if (!d) continue;
      notes.push(d.note);
      if (d.reauthored && !args.halted?.()) r = await args.oracle.verify();
    }
  // The repository's own suite, once the slice's checks are green: the
  // coder reads it as it reads its checks — what is theirs, what is not.
  const suite = (r as VerifyWithSuite).suite;
  if (suite) notes.push(suite.stanza);
  return [formatVerifyReply(r), ...notes].join("\n\n");
}

/** The mandatory green-check, repaired once the same way. */
async function confirmWithRepair(
  args: {
    oracle: VerifyOracle;
    slice: string;
    repair: Repair;
    halted?: () => boolean;
  },
  initial?: { green: boolean; result: VerifyResult },
): Promise<{ green: boolean; result: VerifyResult }> {
  let c = initial ?? (await args.oracle.confirmGreen());
  if (c.green || args.halted?.()) return c;
  const repaired = await repairChecks(args, c.result);
  if (repaired.length && !args.halted?.()) c = await args.oracle.confirmGreen();
  return c;
}

async function repairChecks(
  args: { slice: string; repair: Repair },
  r: VerifyResult,
): Promise<string[]> {
  const broken = failuresByOwner(r).filter((f) => f.owner === "check");
  if (!broken.length) return [];
  return args.repair(args.slice, broken);
}

/**
 * The mandatory green-check with the tree's failures told apart from the
 * coder's: when the build fails only in files this unit does not own while
 * other slices are still landing, the failure is theirs to resolve — this
 * unit waits for the next commit and is graded again, up to six times,
 * without spending a rework.
 */
export async function confirmWaitingForTree(args: {
  oracle: VerifyOracle;
  slice: string;
  repair: Repair;
  halted: () => boolean;
  footprint: readonly string[];
  pendingPlanned?: () => readonly string[];
  othersPending: () => boolean;
  waitForCommit: () => Promise<void>;
  say: (why: string) => void;
}): Promise<{ green: boolean; result: VerifyResult }> {
  // The tree first, then the checks: a missing module another unit will
  // create is waited on, never repaired as a broken check.
  const notReady = (r: VerifyResult): string[] =>
    treeNotReady(r, args.pendingPlanned?.() ?? [], r.kind === "build-failed" ? r.errorFiles : []);
  let confirm = await args.oracle.confirmGreen();
  for (let waits = 0; waits < 6 && !args.halted() && !confirm.green; waits++) {
    const r = confirm.result;
    const planned = notReady(r);
    const foreign =
      r.kind === "build-failed" ? r.errorFiles.filter((f) => !args.footprint.some((m) => f === m || f.startsWith(m + "/"))) : [];
    const onlyForeign = r.kind === "build-failed" && foreign.length > 0 && foreign.length === r.errorFiles.length;
    if (!planned.length && !onlyForeign) break;
    if (!args.othersPending()) break;
    args.say(
      planned.length
        ? `a module the build needs is still being created by another unit (${planned.slice(0, 3).join(", ")}) — waiting for it to land`
        : `the build fails only in files you are not cleared for (${foreign.slice(0, 3).join(", ")}) — waiting for another slice to land`,
    );
    await args.waitForCommit();
    confirm = await args.oracle.confirmGreen();
  }
  if (confirm.green || notReady(confirm.result).length) return confirm;
  return confirmWithRepair(args, confirm);
}

