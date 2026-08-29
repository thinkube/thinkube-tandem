/**
 * What the machine checks about a check before any model is asked.
 *
 * A check is written before the code exists, so it cannot be run for green
 * — but two things about it are decidable the moment it is written, and
 * both have cost whole runs:
 *
 * - Its imports must be able to EXIST. Never "does the file exist" — a check
 *   is written before the code — but "could this path ever exist": the
 *   source directory it corresponds to must be one this repository has, or
 *   one this run's plan will create. `out-test/src/…` where the build emits
 *   `out-test/…` inverts to `src/src/…`, which nothing will ever create.
 * - It may not SIMULATE A SYSTEM THIS REPOSITORY DOES NOT OWN. A fake of an
 *   interface the repository defines and injects is a few lines; a fake of
 *   a foreign platform is a simulator, bigger than the code it tests, with
 *   its own defects, and green against it proves nothing about the real
 *   thing (THE-LADDER §3.2).
 * - It may not READ THE SOURCE INSTEAD OF DRIVING IT. A check that opens a
 *   file and asserts on its text passes for a stub, a comment, or a
 *   coincidence of wording, and fails on a rename that changes nothing. It
 *   proves that something was written, never that anything works.
 * - It must DRIVE SOMETHING THIS CUT BUILDS. A check importing nothing this
 *   run touches is green before the run starts and stays green whatever the
 *   coders do.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface ProbeFault {
  probe: string;
  kind: "import-shape" | "simulator" | "source-text" | "drives-nothing";
  detail: string;
}

/** Relative import specifiers a file names. */
function importsOf(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) out.add(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g)) out.add(m[1]);
  for (const m of source.matchAll(/\brequire\s*\(\s*["'](\.[^"']+)["']\s*\)/g)) out.add(m[1]);
  return [...out];
}

/** Module-loader interception: the mark of a simulator, whatever it fakes. */
function interceptsLoader(source: string): string | undefined {
  const hits = [
    /Module\._load/,
    /Module\._resolveFilename/,
    /require\.cache\s*\[/,
    /registerHooks|register\(\s*["'][^"']*loader/,
  ].find((re) => re.test(source));
  return hits ? hits.source.replace(/\\/g, "") : undefined;
}

/** Reading a source file's TEXT: the check that greps instead of driving.
 *  Reading a fixture is ordinary; reading something the repository compiles
 *  is a check written about the code rather than against it. */
function readsSource(source: string): string | undefined {
  const CODE = /\.(m|c)?[jt]sx?$|\.(py|rb|go|rs|java|kt|php|cs|swift|scala|ex|exs)$/;
  for (const m of source.matchAll(
    /\b(readFileSync|readFile|readFileAsync|read_text|readText|open|File\.read|slurp)\s*\(\s*["'`]([^"'`\n]+)["'`]/g,
  ))
    if (CODE.test(m[2])) return m[2];
  return undefined;
}

/**
 * Audit one probe against the repository it will run in. `root` is a
 * checkout of the base — its SOURCE is the ground truth, because the build
 * output may live in another tree, or not exist yet at all.
 *
 * The question is never "does this file exist" — a check is written before
 * the code — but "could this path ever exist": the DIRECTORY its source
 * corresponds to must exist in the repository, or be one the plan says this
 * run will create. Anything the audit cannot decide, it allows.
 */
export function auditProbe(
  probe: string,
  source: string,
  root: string,
  planned: readonly string[] = [],
): ProbeFault[] {
  const faults: ProbeFault[] = [];
  const grepped = readsSource(source);
  if (grepped)
    faults.push({
      probe,
      kind: "source-text",
      detail:
        `it opens ${grepped} and asserts on the text it finds there. A stub, a comment, or a sentence that happens to match ` +
        `passes that check, and a rename that changes no behaviour fails it. Drive the behaviour instead: call what the promise ` +
        `introduces and assert on what it does.`,
    });
  const loader = interceptsLoader(source);
  if (loader)
    faults.push({
      probe,
      kind: "simulator",
      detail:
        `it intercepts the module loader (${loader}) to hand back an invented platform. A check may fake an interface THIS repository ` +
        `defines and injects; it may not simulate a system the repository does not own.`,
    });
  const plannedDirs = new Set(planned.map((p) => path.posix.dirname(p)));
  for (const spec of importsOf(source)) {
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(probe), spec));
    if (fs.existsSync(path.join(root, rel))) continue; // it is already there
    if (planned.some((p) => p === rel)) continue; // this run writes it
    {
      const dir = path.posix.dirname(rel);
      if (fs.existsSync(path.join(root, dir)) || plannedDirs.has(dir)) continue;
      // A path whose very first segment is absent from this checkout is a
      // build output the tester's tree does not hold: unjudgeable here, so
      // the audit says nothing (THE-LADDER §6 — it fails closed).
      const top = rel.split("/")[0];
      if (!fs.existsSync(path.join(root, top))) continue;
      faults.push({
        probe,
        kind: "import-shape",
        detail: `it imports "${spec}", which resolves to ${rel} — ${dir} exists nowhere in this repository, and nothing in this run's plan will create it.`,
      });
    }
  }
  // Nothing of this cut is imported: whatever it asserts, no coder can
  // change its verdict.
  if (
    planned.length &&
    !faults.some((f) => f.kind === "import-shape") &&
    !importsOf(source).some((spec) => {
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(probe), spec));
      return planned.some((p) => p === rel || p.replace(/\.[^./]+$/, "") === rel.replace(/\.[^./]+$/, ""));
    })
  )
    faults.push({
      probe,
      kind: "drives-nothing",
      detail:
        `it imports nothing this cut builds, so its verdict cannot change whatever any coder writes. Import what the promise ` +
        `introduces — ${planned.slice(0, 4).join(", ")} — and drive it.`,
    });
  return faults;
}

/** Audit every probe a tester wrote; the ones that cannot stand as written. */
export function auditProbes(
  root: string,
  probes: readonly string[],
  planned: readonly string[] = [],
): ProbeFault[] {
  const faults: ProbeFault[] = [];
  for (const rel of probes) {
    let src = "";
    try {
      src = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue; // a missing probe is the run's own business, not this audit's
    }
    faults.push(...auditProbe(rel, src, root, planned));
  }
  return faults;
}

/** What the tester is told, so it fixes them itself before anyone is graded. */
export function faultsBrief(faults: readonly ProbeFault[]): string {
  const lines = [
    "STOP — the checks you wrote cannot stand as written. The machine looked at them before",
    "anyone was graded by them, and found these faults. Fix every one, in place.",
    "",
  ];
  for (const f of faults) lines.push(`- ${f.probe}\n    ${f.detail}`);
  lines.push(
    "",
    "If a check can only observe its promise by simulating a platform this repository does not own,",
    "it is the wrong check: say so in your final words as UNDELIVERED, and write what CAN be observed",
    "at a seam this repository owns.",
  );
  return lines.join("\n");
}

/**
 * Production that imitates the platform, found where the auditor above
 * never looks.
 *
 * The simulator rule watched one street: it reads CHECKS, and it knows a
 * simulator by module-loader interception. So a coder, pressed by a check
 * whose fake input reached deeper than the injected seam, moved the
 * imitation to the other side of the wall: a hand-built object literal
 * cast to the platform's own type, in PRODUCTION —
 *
 *   return { ...base, fsPath, path: fsPath, toString: () => fsPath } as vscodeTypes.Uri;
 *
 * — a counterfeit the platform never made, shaped to keep a test double
 * alive, steered there by the supervisor itself. The injected seam is
 * where the platform ends; production on the far side of it never
 * manufactures the platform's objects.
 *
 * The reading is one shape, product-agnostic: a type-only namespace import
 * from a package this repository does not own, and an object literal cast
 * to one of its types. Said as a finding for the person — an adapter at a
 * genuine boundary can look identical, so this never vetoes.
 */
export function platformImitations(
  file: string,
  source: string,
): { file: string; line: number; detail: string }[] {
  const namespaces = [
    ...source.matchAll(/import\s+type\s+\*\s+as\s+(\w+)\s+from\s+["']([^."'][^"']*)["']/g),
  ].map((m) => ({ ns: m[1], pkg: m[2] }));
  if (!namespaces.length) return [];
  const out: { file: string; line: number; detail: string }[] = [];
  const lines = source.split(/\r?\n/);
  for (const { ns, pkg } of namespaces) {
    const cast = new RegExp(`\\}\\s*as\\s+${ns}\\.(\\w+)`);
    for (let i = 0; i < lines.length; i++) {
      const m = cast.exec(lines[i]);
      if (m)
        out.push({
          file,
          line: i + 1,
          detail:
            `an object literal is cast to ${ns}.${m[1]} — production manufacturing a ${pkg} object the platform never made. ` +
            `If a check's double forced this, the double reached past the injected seam; widen the seam instead.`,
        });
    }
  }
  return out;
}

/**
 * Production the run DELIVERED that imitates the platform it runs on.
 *
 * The simulator rule reads checks; this reads what was actually handed
 * over, because that is where the imitation moved once the checks were
 * watched. Carried as a finding for the person to weigh, never a veto: it
 * is a judgement about taste in code, and by the time the gate has spent
 * every rung the person is the only actor left who can make one.
 */
export async function imitationsDelivered(a: {
  worktree: string;
  baseSha: string;
  exec: (cmd: string, args: string[], cwd: string) => Promise<{ out: string }>;
  readFile: (at: string) => Promise<string>;
  isTestPath: (p: string) => boolean;
}): Promise<{ where: string; detail: string }[]> {
  const out: { where: string; detail: string }[] = [];
  const delivered = (
    await a.exec("git", ["-C", a.worktree, "diff", "--name-only", "--diff-filter=d", `${a.baseSha}..HEAD`], a.worktree)
  ).out
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f && !a.isTestPath(f) && /\.(m|c)?tsx?$/.test(f));
  for (const rel of delivered) {
    let src = "";
    try {
      src = await a.readFile(rel);
    } catch {
      continue;
    }
    for (const hit of platformImitations(rel, src))
      out.push({ where: `${hit.file}:${hit.line}`, detail: hit.detail });
  }
  return out;
}
