/**
 * What the machine checks about a check before any model is asked.
 *
 * A check is written before the code exists, so it cannot be run for green
 * — but two things about it are decidable the moment it is written, and
 * both have cost whole runs:
 *
 * - Its imports must resolve IN SHAPE. The directory it imports from must
 *   exist in the built output. The module itself may be missing — that is
 *   code not written yet — but `out-test/src/…` where the build emits
 *   `out-test/…` is a path no implementation will ever create.
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
 * Where the work still to come will land, in the shape a check must import.
 * A planned source file does not exist yet, and neither does its compiled
 * form — but exactly one path is the one it will occupy, and the door
 * observed the transform (`src/core/author.ts → out-test/core/author.js`).
 * With no build step, a planned source path is its own answer.
 */
export function expectedPaths(plannedSources: readonly string[], emitMap: readonly string[] = []): string[] {
  const pair = emitMap.map((m) => m.split("→").map((x) => x.trim())).find((p) => p.length === 2 && p[0] && p[1]);
  if (!pair) return [...plannedSources];
  const [srcEx, outEx] = pair;
  const srcDir = srcEx.includes("/") ? srcEx.slice(0, srcEx.indexOf("/") + 1) : "";
  const outDir = outEx.includes("/") ? outEx.slice(0, outEx.indexOf("/") + 1) : "";
  const outExt = path.extname(outEx);
  const strips = outEx.replace(outDir, "").split("/").length === srcEx.replace(srcDir, "").split("/").length;
  return plannedSources.map((p) => {
    const stem = p.replace(/\.[^./]+$/, "");
    const tail = strips && srcDir && stem.startsWith(srcDir) ? stem.slice(srcDir.length) : stem;
    return `${outDir}${tail}${outExt}`;
  });
}

/**
 * Audit one probe against the tree it will run in. `root` is the tester's
 * snapshot; `plannedBuilt` are built paths the run's own work will create
 * (so a check may import a module that does not exist yet, as long as its
 * directory does).
 */
export function auditProbe(
  probe: string,
  source: string,
  root: string,
  plannedBuilt: readonly string[] = [],
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
  const here = path.dirname(path.join(root, probe));
  for (const spec of importsOf(source)) {
    const abs = path.resolve(here, spec);
    if (fs.existsSync(abs)) continue;
    const dir = path.dirname(abs);
    if (fs.existsSync(dir)) continue; // the module is not built yet — fine
    const rel = path.relative(root, abs);
    if (plannedBuilt.some((p) => path.resolve(root, p) === abs)) continue;
    faults.push({
      probe,
      kind: "import-shape",
      detail: `it imports "${spec}", and the directory that path names (${path.dirname(rel)}) does not exist in this tree — no implementation can make it appear.`,
    });
  }
  return faults;
}

/** Audit every probe a tester wrote; the ones that cannot stand as written. */
export function auditProbes(
  root: string,
  probes: readonly string[],
  plannedBuilt: readonly string[] = [],
): ProbeFault[] {
  const faults: ProbeFault[] = [];
  for (const rel of probes) {
    let src = "";
    try {
      src = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue; // a missing probe is the run's own business, not this audit's
    }
    faults.push(...auditProbe(rel, src, root, plannedBuilt));
  }
  return faults;
}

/** What the tester is told, so it fixes them itself before anyone is graded. */
export function faultsBrief(faults: readonly ProbeFault[], emitMap: readonly string[] = []): string {
  const lines = [
    "STOP — the checks you wrote cannot stand as written. The machine looked at them before",
    "anyone was graded by them, and found these faults. Fix every one, in place.",
    "",
  ];
  for (const f of faults) lines.push(`- ${f.probe}\n    ${f.detail}`);
  if (emitMap.length)
    lines.push("", `WHERE A SOURCE FILE LANDS, observed in this tree: ${emitMap.join("; ")}. Import that shape literally.`);
  lines.push(
    "",
    "If a check can only observe its promise by simulating a platform this repository does not own,",
    "it is the wrong check: say so in your final words as UNDELIVERED, and write what CAN be observed",
    "at a seam this repository owns.",
  );
  return lines.join("\n");
}
