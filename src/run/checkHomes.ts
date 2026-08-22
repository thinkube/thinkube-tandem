/**
 * Where a check is born.
 *
 * A check used to be filed under the event that produced it —
 * `probes/<space>__SL-n_AC-k.test.mjs` — which is a coordinate in the run,
 * not in the repository. Everything downstream then had to bridge the two:
 * a map from a source path to its built path so the check could import the
 * module it drives, an audit to catch the imports that map got wrong, and a
 * final round to move the check somewhere it could live.
 *
 * A check born where the repository already keeps its tests needs none of
 * that. It sits beside the module it drives, wears the suffix this
 * repository's tests wear, and is compiled and run by the repository's own
 * commands — so the path from the check to its subject is the same before
 * and after the build, whatever the build does.
 *
 * The idiom is OBSERVED, never configured: the repository's own tests say
 * where tests go and what they are called. A repository with no tests at
 * all keeps the old coordinate, because there is nothing to imitate.
 */
import * as path from "node:path";
import { isProbePath, isTestPath } from "./testHomes";

interface TestIdiom {
  /** The suffix this repository's tests wear: `.test.ts`, `_test.go`. */
  suffix: string;
  /** A directory every test lives under, or "" when tests sit beside code. */
  dir: string;
}

/** The suffix a test file's name wears, or "" if it wears none we know. */
function suffixOf(rel: string): string {
  const base = path.basename(rel);
  const m =
    /(\.(test|spec)\..+)$/.exec(base) ??
    /(_(test|spec)\.[^.]+)$/.exec(base) ??
    /^(test)_.*?(\.[^.]+)$/.exec(base);
  if (!m) return "";
  // `test_foo.py` names its kind at the front; the suffix we mint is still
  // a suffix, so it becomes `_test.py` — a shape that repository also reads.
  return m[1] === "test" ? `_test${m[2]}` : m[1];
}

/** How this repository names and houses its tests, read from the tests it has. */
function inferTestIdiom(files: readonly string[]): TestIdiom | undefined {
  const tests = files.filter((f) => f && isTestPath(f) && !isProbePath(f));
  if (!tests.length) return undefined;
  const counted = new Map<string, number>();
  for (const t of tests) {
    const s = suffixOf(t);
    if (s) counted.set(s, (counted.get(s) ?? 0) + 1);
  }
  const suffix = [...counted.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!suffix) return undefined;
  // A test directory only counts when the repository puts EVERY test there;
  // one stray `tests/` beside a hundred co-located tests is not the idiom.
  const tops = new Set(tests.map((t) => t.split("/")[0]));
  const dir = tops.size === 1 && /^(tests?|spec|__tests__)$/.test([...tops][0]) ? `${[...tops][0]}/` : "";
  return { suffix, dir };
}

/**
 * The path a check is born at: beside the module it drives, named for the
 * criterion it proves, in the repository's own idiom.
 *
 * The ordinal stays in the name because the run reads it back — a check's
 * verdict is reported against the criterion it was written from.
 */
function checkHomeIn(idiom: TestIdiom, subject: string, k: number): string {
  const stem = subject.replace(/\.[^./]+$/, "");
  const rel = idiom.dir ? `${idiom.dir}${path.basename(stem)}` : stem;
  return `${rel}_AC-${k}${idiom.suffix}`;
}

/** A unit of a plan, as far as this rehousing is concerned. */
interface UnitLike {
  role?: string;
  footprint: string[];
  cleared?: { action: "create" | "change" | "delete"; path: string }[];
}
interface SliceLike {
  handle?: string;
  workUnits?: UnitLike[];
  units?: UnitLike[];
  files?: string[];
}

/**
 * Move every check this plan would file under `probes/` to the repository's
 * own test homes, beside the production file its slice lands in.
 *
 * Returns what moved, for the log. A slice with no production file of its
 * own keeps the old coordinate: there is nothing to sit beside.
 */
export function rehouseChecks(
  slices: readonly SliceLike[],
  repoFiles: readonly string[],
): { from: string; to: string }[] {
  const idiom = inferTestIdiom(repoFiles);
  if (!idiom) return [];
  const moved: { from: string; to: string }[] = [];
  for (const s of slices) {
    const units = s.workUnits ?? s.units ?? [];
    const subject = units
      .filter((u) => (u.role ?? "code") === "code")
      .flatMap((u) => u.footprint)
      .find((f) => !isTestPath(f));
    if (!subject) continue;
    for (const u of units) {
      if ((u.role ?? "code") !== "test") continue;
      u.footprint = u.footprint.map((f) => {
        const k = /_AC-(\d+)/.exec(f)?.[1];
        if (!isProbePath(f) || !k) return f;
        const to = checkHomeIn(idiom, subject, Number(k));
        moved.push({ from: f, to });
        return to;
      });
      if (u.cleared)
        u.cleared = u.cleared.map((c) => {
          const hit = moved.find((m) => m.from === c.path);
          return hit ? { ...c, path: hit.to } : c;
        });
    }
    if (s.files)
      s.files = s.files.map((f) => moved.find((m) => m.from === f)?.to ?? f);
  }
  return moved;
}
