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
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface ProbeFault {
  probe: string;
  kind: "import-shape" | "simulator";
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
export function interceptsLoader(source: string): string | undefined {
  const hits = [
    /Module\._load/,
    /Module\._resolveFilename/,
    /require\.cache\s*\[/,
    /registerHooks|register\(\s*["'][^"']*loader/,
  ].find((re) => re.test(source));
  return hits ? hits.source.replace(/\\/g, "") : undefined;
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
