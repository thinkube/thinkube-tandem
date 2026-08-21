/**
 * The closer: the floor of the ladder (THE-LADDER §4).
 *
 * Every rung above it fails fast, because something better waits behind.
 * Nothing waits behind the closer, so it is not rationed by a count: it
 * works while it makes progress and stops when the evidence stops moving.
 *
 * It sees everything — including the checks, whose blinding has already
 * done its work by then: they were written from the signed criteria before
 * the code existed. It may change production or a check. What it may not do
 * is declare itself finished: green is decided by execution, and a change
 * to a check must be justified against the criterion it proves and lands as
 * a ruling on the delivery.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkerModel } from "../engine/workerModel";
import { runUnitWorker, porcelainPaths, encloseWork } from "./worker";
import { formatBuild } from "./execs";
import type { WorkerOutcome } from "./worker";

/** How much room the last actor gets: wide, because nothing follows it. */
const CLOSER_TURNS = 200;
/** Rounds that changed nothing end it — progress, never patience. */
const NO_PROGRESS_LIMIT = 2;

interface CloserState {
  /** Fewer is better: red checks, build errors, red standing tests. */
  score: number;
  /** What the actor is shown: the current evidence, in the tools' own words. */
  evidence: string;
  green: boolean;
  /** Files the CURRENT evidence says it must reach to finish. Authority is
   *  not a sentence in a brief: what fails the closer, the closer may edit. */
  alsoOwn?: string[];
}

export interface CloserArgs {
  /** What is being closed, for the record: a unit id, or the delivery. */
  subject: string;
  /** Where production is written — the tree the run commits from. */
  worktree: string;
  /** Production files it may edit, relative to `worktree`. */
  footprint: string[];
  /** The checks: a second tree, and the files in it this closer may correct.
   *  They live apart from production, so the fence for them is its own. */
  checks?: { root: string; paths: string[] };
  /** Its full sight: the checks it is judged by, read from the tester's tree. */
  probeSources: { path: string; source: string }[];
  /** What the run already tried and could not settle. */
  history: string[];
  criteria: { id: string; text: string }[];
  digest?: string;
  prepare?: string;
  model: string;
  workerModel?: Parameters<typeof resolveWorkerModel>[0];
  /** Grades the current tree: the same execution everyone else is judged by. */
  measure: () => Promise<CloserState>;
  exec: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
  boundedExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  halted: () => boolean;
  log: (line: string) => void;
  say: (text: string | undefined) => void;
  onRuling: (r: { criterionId: string; unit: string; granted: boolean; reason: string }) => void;
  defect: (entry: { activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
  worker?: typeof runUnitWorker;
}

/** The brief: everything, plainly, and the one law that still binds it. */
function closerBrief(a: {
  subject: string;
  round: number;
  state: CloserState;
  history: readonly string[];
  criteria: readonly { id: string; text: string }[];
  probeSources: readonly { path: string; source: string }[];
  footprint: readonly string[];
  worktree: string;
  checks?: { root: string; paths: readonly string[] };
  digest?: string;
}): string {
  const lines = [
    `You are the CLOSER for ${a.subject} (round ${a.round}). Every other actor in this run has`,
    "tried and could not finish. Nothing follows you, so nothing is withheld from you: you see the",
    "checks themselves, you may change production code, and you may change a check.",
    "",
    "THE ONE LAW: green is decided by running things, never by your account of them. Call the",
    "verify tool when you believe it is done. If you change a CHECK, you must justify the change",
    "against the criterion it proves, in a line beginning `RULING:` — a check may be corrected,",
    "never weakened, and never deleted to reach green.",
    "",
    "Work while you are making progress: fewer red checks, fewer build errors, fewer red standing",
    "tests. When you cannot move it further, stop and say exactly what remains and why, in a line",
    "beginning `UNDELIVERED:` — your report is how the machine learns what its cheaper actors",
    "could not do.",
    "",
    "──── WHERE IT STANDS NOW ────",
    a.state.evidence.slice(0, 6000),
    "",
    "──── WHAT THE CRITERIA REQUIRE (the human signed these) ────",
    ...a.criteria.map((c) => `- ${c.text}`),
    "",
    "──── WHAT THE RUN ALREADY TRIED ────",
    ...a.history.slice(0, 20).map((h) => `- ${h}`),
    "",
    "──── THE CHECKS, IN FULL ────",
    ...a.probeSources.slice(0, 12).map((p) => `── ${p.path} ──\n${p.source.slice(0, 6000)}`),
    "",
    `──── PRODUCTION: EDIT THESE, IN ${a.worktree} ────`,
    "This tree is the one the run commits from. Work here, and nowhere else — a file you",
    "change in any other directory is thrown away when the run ends.",
    ...a.footprint.map((f) => `- ${f}`),
  ];
  if (a.checks?.paths.length)
    lines.push(
      "",
      `──── THE CHECKS: A SEPARATE TREE, AT ${a.checks.root} ────`,
      "You may correct these check files, in place, at that absolute path — and nothing else there.",
      "Never write production code into the checks' tree: it is not committed, and the work is lost.",
      ...a.checks.paths.map((p) => `- ${p}`),
    );
  if (a.digest) lines.push("", "──── THE REPOSITORY, READ FOR YOU ────", a.digest.slice(0, 8000));
  return lines.join("\n");
}

/** Rulings the closer declared for the checks it changed. */
export function rulingsIn(finalText: string): string[] {
  return (finalText ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*+]\s*/, ""))
    .filter((l) => /^RULING:/i.test(l))
    .map((l) => l.replace(/^RULING:\s*/i, "").trim())
    .filter(Boolean);
}

/**
 * Close it, or say precisely why it could not be closed. Returns whether the
 * subject went green, and the closer's own last words.
 */
export async function close(a: CloserArgs): Promise<{ green: boolean; report: string; rounds: number }> {
  const worker = a.worker ?? runUnitWorker;
  const owns = new Set(a.footprint);
  // Authority, as a fact rather than a sentence: whatever the evidence says
  // is failing it, the closer may edit. A last actor fenced out of the file
  // that fails it can only report — which is what happened, twice, in one run.
  const grant = (paths: readonly string[] | undefined): void => {
    const fresh = (paths ?? []).filter((p) => !owns.has(p));
    if (!fresh.length) return;
    for (const p of fresh) owns.add(p);
    a.log(`⚖ ${a.subject}: the closer takes ${fresh.slice(0, 4).join(", ")}${fresh.length > 4 ? "…" : ""} — the evidence says they are what fails it`);
  };
  const before = await a.measure();
  if (before.green) return { green: true, report: "nothing to close", rounds: 0 };
  grant(before.alsoOwn);
  a.log(`🛟 ${a.subject}: every other actor is spent — the closer takes it, with full sight and authority`);
  const checkRoot = a.checks?.root;
  const checkPaths = a.checks?.paths ?? [];
  const checkBaseline = checkRoot ? new Set(await porcelainPaths(checkRoot)) : new Set<string>();
  let best = before.score;
  let stale = 0;
  let round = 0;
  let outcome: WorkerOutcome = { ok: false, finalText: "" };
  let state = before;
  while (!a.halted() && stale < NO_PROGRESS_LIMIT) {
    round++;
    a.say(`the closer is working — round ${round}, ${state.score} thing(s) still red`);
    const abort = new AbortController();
    const footprint = [...owns, ...checkPaths.map((p) => path.join(checkRoot ?? "", p))];
    outcome = await worker(
      {
        model: resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "closer"),
        worktree: a.worktree,
        // It writes production and checks alike: the roles are spent.
        role: "test",
        footprint,
        maxTurns: CLOSER_TURNS,
        baseline: new Set(await porcelainPaths(a.worktree)),
        abort,
        onPark: (_q, answer) =>
          answer("You are the last actor: decide it yourself from the criteria and the evidence. The run does not ask a person."),
        log: a.log,
        ...(a.prepare ? { buildTool: async () => formatBuild(await a.boundedExec(a.prepare!, a.worktree)) } : {}),
        verifyTool: async () => {
          a.say("the closer is being graded");
          state = await a.measure();
          grant(state.alsoOwn);
          return state.evidence;
        },
      },
      closerBrief({
        subject: a.subject,
        round,
        state,
        history: a.history,
        criteria: a.criteria,
        probeSources: a.probeSources,
        footprint: [...owns],
        worktree: a.worktree,
        ...(checkRoot ? { checks: { root: checkRoot, paths: checkPaths } } : {}),
        ...(a.digest ? { digest: a.digest } : {}),
      }),
    );
    // The checks live in their own tree, which no other fence watches: a
    // production file written there is lost work, so it goes back at once.
    if (checkRoot) await encloseWork({ worktree: checkRoot, footprint: [...checkPaths], baseline: checkBaseline, log: a.log });
    state = await a.measure();
    grant(state.alsoOwn);
    for (const r of rulingsIn(outcome.finalText)) {
      const crit = a.criteria.find((c) => r.includes(c.text.slice(0, 30))) ?? a.criteria[0];
      a.onRuling({ criterionId: crit?.id ?? "closer", unit: a.subject, granted: true, reason: `the closer corrected a check: ${r.slice(0, 300)}` });
      a.log(`⚖ ${a.subject}: the closer corrected a check — ${r.slice(0, 160)}`);
    }
    if (state.green) break;
    if (state.score < best) {
      best = state.score;
      stale = 0;
    } else stale++;
  }
  const report = outcome.finalText.trim().slice(0, 2000);
  a.defect({
    activity: "closing",
    trigger: "closer",
    type: state.green ? "contract" : "code",
    impact: state.green ? "closed what no other actor could" : "the closer could not finish it either",
    detail: `${a.subject} — ${round} round(s)\n${report}`.slice(0, 1500),
  });
  a.log(
    state.green
      ? `✓ ${a.subject}: the closer finished it in ${round} round(s)`
      : `⛔ ${a.subject}: the closer could not finish it — ${report.split("\n")[0].slice(0, 200)}`,
  );
  a.say(undefined);
  return { green: state.green, report, rounds: round };
}

/** The checks a slice is judged by, read whole — the closer sees everything. */
export function readProbes(testerWt: string, probes: readonly string[]): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const rel of probes) {
    try {
      out.push({ path: rel, source: fs.readFileSync(path.join(testerWt, rel), "utf8") });
    } catch {
      /* a check with no file is the run's own defect, reported elsewhere */
    }
  }
  return out;
}
