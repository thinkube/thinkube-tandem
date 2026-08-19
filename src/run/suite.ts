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
import { isTestPath } from "./testHomes";
import { isMaintainUnit } from "./plan";

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
export function parseSuite(output: string, root?: string): SuiteVerdict {
  const lines = output.split(/\r?\n/);
  const failures: SuiteFailure[] = [];
  const summary: string[] = [];
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
    failures.push({ name, ...(file ? { file } : {}), detail: detail.join("\n").slice(0, 1200) });
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
export function sourceOf(compiled: string, root?: string): string | undefined {
  const m = /(?:^|\/)out(?:-test)?\/(.+)\.(?:m?js)$/.exec(compiled.replace(/\\/g, "/"));
  if (!m) return undefined;
  const stem = m[1];
  const candidates = [`src/${stem}.ts`, `src/${stem}.tsx`, `src/${stem}.mts`, `${stem}.ts`];
  if (!root) return candidates[0];
  return candidates.find((c) => fs.existsSync(path.join(root, c))) ?? candidates[0];
}

export type SuiteOwner = "code" | "maintainer" | "tree" | "environment";

/** The one failure a suite that could not run at all reports. */
const COULD_NOT_RUN = /^the suite exited with code /;

/**
 * Who a red suite test belongs to, from the coder's point of view:
 *   maintainer  — the test file is a test home a maintain unit brings under
 *                 after this code lands; it pins the old rule, not a break
 *   tree        — the failure names a file another unit will still create
 *   environment — the suite could not run here at all, and what it says
 *                 names none of the coder's files: the runner, not the work
 *   code        — everything else: the coder's tree broke a standing check
 */
export function suiteOwner(
  f: SuiteFailure,
  ctx: { maintainHomes: readonly string[]; pendingPlanned: readonly string[]; footprint?: readonly string[] },
): SuiteOwner {
  if (f.file && ctx.maintainHomes.includes(f.file)) return "maintainer";
  if (COULD_NOT_RUN.test(f.name) && !(ctx.footprint ?? []).some((p) => f.detail.includes(p))) return "environment";
  // A planned file is named in the runner's words by its path, or by its
  // compiled name (the same path without `src/` and without an extension).
  const names = (p: string) => [p, stemOf(p), stemOf(p).replace(/^src\//, "")].filter((n) => n.length > 3);
  if (ctx.pendingPlanned.some((p) => names(p).some((n) => f.detail.includes(n)))) return "tree";
  return "code";
}

const stemOf = (p: string): string => p.replace(/\.[^./]+$/, "");

/** The coder's reading of the suite: what is theirs, what is not. */
export function suiteStanza(v: SuiteVerdict, owners: Map<SuiteFailure, SuiteOwner>): string {
  if (v.green) return "──── THE REPOSITORY'S OWN CHECKS ────\nGreen on your tree.";
  const mine = v.failures.filter((f) => owners.get(f) === "code");
  const theirs = v.failures.filter((f) => owners.get(f) === "maintainer");
  const tree = v.failures.filter((f) => owners.get(f) === "tree");
  const env = v.failures.filter((f) => owners.get(f) === "environment");
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
    confirmGreen: async () => {
      const c = await inner.confirmGreen();
      if (!c.green) return c;
      const result = await grade(c.result);
      const green = !result.suite || suiteAcceptable(result.suite);
      return { green, result };
    },
  };
}

/** Green for the coder: every red is a maintainer's to bring under, or the
 *  runner's own failure to run the suite. The tree's failures are not
 *  green — they are waited on. */
export function suiteAcceptable(s: NonNullable<VerifyWithSuite["suite"]>): boolean {
  return s.verdict.green || [...s.owners.values()].every((o) => o === "maintainer" || o === "environment");
}

/** Only the tree's failures: wait, do not rework. */
export function suiteWaitsForTree(s: NonNullable<VerifyWithSuite["suite"]>): boolean {
  const owners = [...s.owners.values()];
  return !s.verdict.green && owners.length > 0 && owners.every((o) => o === "tree");
}

/** Every test home a maintain unit brings under, across the plan. */
export function maintainHomesOf(slices: readonly { workUnits: readonly { role?: string; footprint: readonly string[] }[] }[]): string[] {
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
