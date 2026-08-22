/**
 * The repository's own suite as a check in the run.
 *
 * The suite is the truth about whether a tree stands. It is graded where the
 * work is done — at every slice's verify, once the slice's own checks are
 * green — and each red test has an owner: the coder whose tree broke it, the
 * maintainer whose test home pins the old rule, or the tree that is not
 * ready yet. Nothing about it reaches the person as a decision.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { VerifyOracle, VerifyResult } from "../engine/verifyOracle";
import { isProbePath, isTestPath } from "./testHomes";
import { isMaintainUnit } from "./plan";
import { importersIn } from "../dispatch/needs";

/** One red test of the suite, named and located. */
export interface SuiteFailure {
  name: string;
  /** The test's source file, when the runner's location could be mapped back. */
  file?: string;
  /** The runner's own words: the assertion, the diff, the first frames. */
  detail: string;
}

export interface SuiteVerdict {
  green: boolean;
  failures: SuiteFailure[];
  /** The runner's summary lines (pass/fail counts). */
  summary: string;
}

/** The suite's TAP output read into named failures. A `location:` line
 *  under a failure names the compiled file; the source it came from is the
 *  same path under `src/` with a source extension, when it exists. */
function parseSuite(output: string, root?: string): SuiteVerdict {
  const lines = output.split(/\r?\n/);
  const failures: SuiteFailure[] = [];
  const summary: string[] = [];
  // What the runner printed BEFORE its first verdict. A test that cannot
  // even load — a module another unit has yet to create, a syntax error —
  // says so there, in `#` diagnostics, and the verdict line that follows
  // carries nothing but the file name. Dropping the preamble left the
  // machine unable to tell "the tree is not ready yet" from "your code
  // broke this", which is the difference between waiting and being blamed.
  const preamble = lines
    .slice(0, lines.findIndex((l) => /^not ok \d+ /.test(l)) + 1 || lines.length)
    .filter((l) => /^#\s+\S/.test(l) && !/^# (Subtest|tests|pass|fail|cancelled|skipped|todo|duration)/.test(l))
    .map((l) => l.replace(/^#\s?/, ""))
    .join("\n")
    .slice(0, 800);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^# (pass|fail|tests|cancelled|skipped) /.test(l)) summary.push(l.trim());
    const m = /^not ok \d+ - (.*)$/.exec(l);
    if (!m) continue;
    const name = m[1].trim();
    // Only top-level failures name a test the reader can act on; a nested
    // "not ok" belongs to its parent and repeats the same name lower down.
    const detail: string[] = [];
    let file: string | undefined;
    for (let j = i + 1; j < lines.length && detail.length < 14; j++) {
      const d = lines[j];
      if (/^(not )?ok \d+ /.test(d) || /^# Subtest:/.test(d)) break;
      const loc = /location: '([^':]+):\d+/.exec(d);
      if (loc && !file) file = sourceOf(loc[1], root);
      if (/^\s+(error:|expected|actual|\+ |- |Error|operator)/.test(d) || /^\s{4}\S/.test(d)) detail.push(d.trimEnd());
    }
    failures.push({
      name,
      ...(file ? { file } : {}),
      detail: [detail.join("\n"), failures.length === 0 && preamble ? preamble : ""].filter(Boolean).join("\n").slice(0, 1600),
    });
  }
  // A subtest and its parent both print "not ok" with the same words: keep one.
  const seen = new Set<string>();
  const unique = failures.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)));
  const failCount = /^# fail ([1-9]\d*)/m.test(output);
  return { green: unique.length === 0 && !failCount, failures: unique, summary: summary.join(" · ") };
}

/** The suite's verdict from its exit code and output: red output names its
 *  tests; a red exit with nothing named is one failure in the runner's words. */
export function suiteVerdictOf(code: number | null, output: string, root?: string): SuiteVerdict {
  const v = parseSuite(output, root);
  if (code === 0 && v.green) return v;
  if (v.failures.length) return { ...v, green: false };
  const tail = output.trim().split(/\r?\n/).slice(-15).join("\n").slice(0, 1200);
  return { green: false, failures: [{ name: `the suite exited with code ${code ?? "null"}`, detail: tail }], summary: v.summary };
}

/** `…/out-test/a/b.test.js` → `src/a/b.test.ts` when that file exists under root. */
function sourceOf(compiled: string, root?: string): string | undefined {
  const m = /(?:^|\/)out(?:-test)?\/(.+)\.(?:m?js)$/.exec(compiled.replace(/\\/g, "/"));
  if (!m) return undefined;
  const stem = m[1];
  const candidates = [`src/${stem}.ts`, `src/${stem}.tsx`, `src/${stem}.mts`, `${stem}.ts`];
  if (!root) return candidates[0];
  return candidates.find((c) => fs.existsSync(path.join(root, c))) ?? candidates[0];
}

export type SuiteOwner = "code" | "maintainer" | "tree" | "environment" | "elsewhere";

/** The one failure a suite that could not run at all reports. */
const COULD_NOT_RUN = /^the suite exited with code /;

/**
 * Who a red suite test belongs to, from the coder's point of view:
 *   maintainer  — the test file is a test home a maintain unit brings under
 *                 after this code lands; it pins the old rule, not a break
 *   tree        — the failure names a file another unit will still create
 *   environment — the suite could not run here at all, and what it says
 *                 names none of the coder's files: the runner, not the work
 *   code        — the failure names one of this unit's own files
 *   elsewhere   — it names none of them: every coder shares one tree, so a
 *                 red here is as likely another slice's in-flight work as
 *                 this one's. It is recorded and carried to the closing
 *                 gate, which sees the whole tree and can reach every file.
 *
 * The default is elsewhere, not code, and the reason is a run that failed
 * four units whose own checks were all green: one slice's uncommitted
 * change reddened standing tests in files those units could not edit, and
 * each was reworked, closed and failed for a break it had no hand in.
 * A unit is answerable for what its own files break — never for a tree it
 * shares.
 */
function suiteOwner(
  f: SuiteFailure,
  ctx: { maintainHomes: readonly string[]; pendingPlanned: readonly string[]; footprint?: readonly string[] },
): SuiteOwner {
  if (f.file && ctx.maintainHomes.includes(f.file)) return "maintainer";
  const mine = ctx.footprint ?? [];
  const namesMine = mine.some((p) => f.detail.includes(p)) || (!!f.file && mine.includes(f.file));
  if (COULD_NOT_RUN.test(f.name) && !namesMine) return "environment";
  // A planned file is named in the runner's words by its path, or by its
  // compiled name (the same path without `src/` and without an extension).
  const names = (p: string) => [p, stemOf(p), stemOf(p).replace(/^src\//, "")].filter((n) => n.length > 3);
  if (ctx.pendingPlanned.some((p) => names(p).some((n) => f.detail.includes(n)))) return "tree";
  return namesMine ? "code" : "elsewhere";
}

const stemOf = (p: string): string => p.replace(/\.[^./]+$/, "");

/** The coder's reading of the suite: what is theirs, what is not. */
export function suiteStanza(v: SuiteVerdict, owners: Map<SuiteFailure, SuiteOwner>): string {
  if (v.green) return "──── THE REPOSITORY'S OWN CHECKS ────\nGreen on your tree.";
  const mine = v.failures.filter((f) => owners.get(f) === "code");
  const theirs = v.failures.filter((f) => owners.get(f) === "maintainer");
  const tree = v.failures.filter((f) => owners.get(f) === "tree");
  const env = v.failures.filter((f) => owners.get(f) === "environment");
  const other = v.failures.filter((f) => owners.get(f) === "elsewhere");
  const line = (f: SuiteFailure) => `- ${f.name}${f.file ? ` (${f.file})` : ""}\n${f.detail.split("\n").map((d) => "    " + d.trim()).join("\n")}`;
  const out: string[] = ["──── THE REPOSITORY'S OWN CHECKS (they must stay green on your tree — the whole suite, not only your checks) ────", v.summary];
  if (mine.length)
    out.push(
      "",
      "YOURS — your tree makes these standing checks fail. Fix the cause in your files; never weaken a check:",
      ...mine.map(line),
    );
  if (theirs.length)
    out.push(
      "",
      "NOT YOURS — these are test homes a maintainer brings under after your code lands; they pin the old rule and do not count against you:",
      ...theirs.map((f) => `- ${f.name}${f.file ? ` (${f.file})` : ""}`),
    );
  if (tree.length)
    out.push(
      "",
      "THE TREE IS NOT READY — these name a file another unit will still create; verify again in a moment:",
      ...tree.map((f) => `- ${f.name}`),
    );
  if (other.length)
    out.push(
      "",
      "NOT YOURS — these name none of your files. Every coder shares this tree, so they are as likely another slice's in-flight work; they are recorded and carried to the closing gate, which sees the whole tree:",
      ...other.map((f) => `- ${f.name}${f.file ? ` (${f.file})` : ""}`),
    );
  if (env.length)
    out.push(
      "",
      "ENVIRONMENT (not your code) — the suite could not run in this runner; the closing gate runs it on the delivered tree:",
      ...env.map(line),
    );
  return out.join("\n");
}

/** A verify result with the suite's word attached, when it was run. */
export type VerifyWithSuite = VerifyResult & {
  suite?: { verdict: SuiteVerdict; owners: Map<SuiteFailure, SuiteOwner>; stanza: string };
};

const allProbesGreen = (r: VerifyResult): boolean => r.kind === "results" && r.results.every((x) => x.pass);

/**
 * The oracle with the suite behind it: once a round's own checks are all
 * green, the repository's suite runs in the same runner and its red tests
 * are owned. Green means green for both — a coder is not done while the
 * repository's standing checks are red on its tree, unless every red is a
 * maintainer's or the tree's. The suite is run once per verified state.
 */
export type SuiteOracle = Omit<VerifyOracle, "verify" | "confirmGreen"> & {
  verify(): Promise<VerifyWithSuite>;
  confirmGreen(): Promise<{ green: boolean; result: VerifyWithSuite }>;
};

export function withSuite(
  inner: VerifyOracle,
  opts: {
    run: () => Promise<SuiteVerdict>;
    maintainHomes: () => readonly string[];
    pendingPlanned: () => readonly string[];
    /** The acting slice's own files — what a could-not-run failure must name to be theirs. */
    footprint?: () => readonly string[];
    log?: (line: string) => void;
    /** The suite could not run in the runner: on the record, not the coder's. */
    onEnvironment?: (detail: string) => void;
  },
): SuiteOracle {
  const cache = new Map<string, VerifyWithSuite["suite"]>();
  const grade = async (r: VerifyResult): Promise<VerifyWithSuite> => {
    if (!allProbesGreen(r)) return r;
    const key = inner.last()?.stateHash;
    let suite = key ? cache.get(key) : undefined;
    if (!suite) {
      opts.log?.("[suite] the slice's checks are green — running the repository's own suite on this tree");
      const verdict = await opts.run();
      const owners = new Map<SuiteFailure, SuiteOwner>();
      const ctx = { maintainHomes: opts.maintainHomes(), pendingPlanned: opts.pendingPlanned(), footprint: opts.footprint?.() ?? [] };
      for (const f of verdict.failures) owners.set(f, suiteOwner(f, ctx));
      for (const f of verdict.failures) if (owners.get(f) === "environment") opts.onEnvironment?.(f.detail);
      suite = { verdict, owners, stanza: suiteStanza(verdict, owners) };
      opts.log?.(
        verdict.green
          ? "[suite] green"
          : `[suite] red — ${verdict.failures.length} test(s): ${verdict.failures.map((f) => `${f.name} [${owners.get(f)}]`).join("; ").slice(0, 600)}`,
      );
      if (key) cache.set(key, suite);
    }
    return { ...r, suite };
  };
  return {
    ...inner,
    preflight: inner.preflight,
    invocations: () => inner.invocations(),
    last: () => inner.last(),
    verify: async () => grade(await inner.verify()),
    // The slice's checks decide the unit. The repository's suite is run
    // here for the coder to READ — never to judge it. A red belonging to a
    // file this unit cannot touch is not a verdict on this unit, and three
    // nights were lost to the machinery that tried to decide whose it was:
    // ownership classes, waits for a tree that never came, units failed
    // with every one of their own checks green. The gate judges the suite,
    // once, on the delivered tree, where every file is reachable and the
    // finisher and the closer can act.
    confirmGreen: async () => {
      const c = await inner.confirmGreen();
      if (!c.green) return c;
      return { green: true, result: await grade(c.result) };
    },
  };
}

/**
 * The standing tests that matter to a slice: every test file that imports
 * one of its files, directly or through production it imports (bounded
 * walk over the graph's importers), plus the files that were red at an
 * earlier gate. Only files present in the tree are returned.
 */
async function scopedTests(args: {
  root: string;
  footprint: readonly string[];
  importersOf: (path: string) => Promise<readonly string[]>;
  always?: readonly string[];
  maxFiles?: number;
}): Promise<string[]> {
  const max = args.maxFiles ?? 60;
  const seen = new Set<string>();
  const tests = new Set<string>();
  const queue: { path: string; depth: number }[] = args.footprint.filter((p) => !isTestPath(p)).map((path) => ({ path, depth: 0 }));
  for (const t of args.footprint) if (isTestPath(t) && !isProbePath(t)) tests.add(t);
  while (queue.length && tests.size < max) {
    const { path: p, depth } = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const importers = await args.importersOf(p).catch(() => [] as readonly string[]);
    for (const i of importers) {
      if (isProbePath(i)) continue;
      if (isTestPath(i)) tests.add(i);
      else if (depth < 3 && !seen.has(i)) queue.push({ path: i, depth: depth + 1 });
    }
  }
  for (const r of args.always ?? []) tests.add(r);
  return [...tests].filter((t) => fs.existsSync(path.join(args.root, t))).slice(0, max);
}

/**
 * Run the slice's standing tests one file at a time with the repository's
 * proven single-test command; the verdicts, named per file, as one suite.
 */
export async function runScopedSuite(args: {
  runOne: string;
  root: string;
  exec: (cmd: string) => Promise<{ code: number | null; output: string }>;
  footprint: readonly string[];
  importersOf: (path: string) => Promise<readonly string[]>;
  always?: readonly string[];
  log?: (line: string) => void;
}): Promise<SuiteVerdict> {
  const files = await scopedTests(args);
  if (!files.length) {
    args.log?.("[suite] no standing test imports this slice's files — nothing to run here; the gate runs the whole suite");
    return { green: true, failures: [], summary: "no standing test imports this slice's files" };
  }
  args.log?.(`[suite] running ${files.length} standing test file(s) that import this slice's files: ${files.slice(0, 5).join(", ")}${files.length > 5 ? "…" : ""}`);
  const failures: SuiteFailure[] = [];
  let pass = 0;
  for (const f of files) {
    const r = await args.exec(args.runOne.replace(/<file>/g, f));
    const v = suiteVerdictOf(r.code, r.output, args.root);
    if (v.green) {
      pass++;
      continue;
    }
    // A test file that fails names itself even when its runner's words do not.
    for (const x of v.failures) failures.push({ ...x, file: x.file ?? f, name: x.name.startsWith("the suite exited") ? `${f}: ${x.name.replace("the suite", "the test")}` : x.name });
  }
  return { green: failures.length === 0, failures, summary: `${files.length} standing test file(s): ${pass} green, ${files.length - pass} red` };
}

/** The oracle's suite arguments for a run: the proven single-test command,
 *  the graph's importers, the tests that bit before, and the plan's owners. */
export function sliceSuiteArgs(a: {
  runOne: string;
  exec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  affected?: (path: string) => Promise<string>;
  reds?: readonly string[];
  slices: readonly { workUnits: readonly { role?: string; footprint: readonly string[] }[] }[];
  pendingPlanned: () => readonly string[];
}): {
  runOne: string;
  exec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  importersOf: (path: string) => Promise<readonly string[]>;
  reds: readonly string[];
  maintainHomes: () => readonly string[];
  pendingPlanned: () => readonly string[];
} {
  return {
    runOne: a.runOne,
    exec: a.exec,
    importersOf: async (p) => (a.affected ? importersIn(await a.affected(p).catch(() => "")) : []),
    reds: a.reds ?? [],
    maintainHomes: () => maintainHomesOf(a.slices),
    pendingPlanned: a.pendingPlanned,
  };
}

/** Every test home a maintain unit brings under, across the plan. */
function maintainHomesOf(slices: readonly { workUnits: readonly { role?: string; footprint: readonly string[] }[] }[]): string[] {
  return slices.flatMap((s) => s.workUnits.filter(isMaintainUnit).flatMap((u) => [...u.footprint]));
}

/** Which test files a set of failures point at, plus the production files
 *  those tests are named after — the footprint of a suite repair. */
export function suiteFootprint(failures: readonly SuiteFailure[], root: string): string[] {
  const out = new Set<string>();
  for (const f of failures) {
    if (f.file && fs.existsSync(path.join(root, f.file))) out.add(f.file);
    if (f.file && isTestPath(f.file)) {
      const prod = f.file.replace(/\.(test|spec)\.([cm]?[jt]sx?)$/, ".$2");
      if (prod !== f.file && fs.existsSync(path.join(root, prod))) out.add(prod);
    }
    for (const m of f.detail.matchAll(/\b((?:src|docs|webview)\/[\w./-]+\.[a-z]+)/g))
      if (fs.existsSync(path.join(root, m[1]))) out.add(m[1]);
  }
  return [...out];
}
