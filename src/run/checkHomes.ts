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

/** Files a check can sit beside and import — source, in any language here. */
const CODE = /\.(m|c)?[jt]sx?$|\.(py|rb|go|rs|java|kt|php|cs|swift|scala|ex|exs|lua)$/i;

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

/**
 * The ordinals a check may take beside one module, once every plan already
 * counted from one.
 *
 * A criterion's ordinal is its place within its own slice, and two slices
 * that drive the same module both start at one. Beside the module they
 * both drive, that is the same filename twice: the second tester finds the
 * first one's checks at its own addresses, and whatever it does next is
 * wrong — overwrite another unit's proof, or write outside the footprint
 * its guard enforces and be stopped for it.
 *
 * So the ordinal is allocated across the whole plan, per module. The name
 * still says only which criterion it proves; nothing of the run enters it.
 */
function nextFreeIn(taken: Set<string>, idiom: TestIdiom, subject: string, k: number): string {
  let n = k;
  let at = checkHomeIn(idiom, subject, n);
  while (taken.has(at)) at = checkHomeIn(idiom, subject, ++n);
  taken.add(at);
  return at;
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
  /** Files already on the run's branch. A check that was ALREADY WRITTEN
   *  in an earlier run keeps its address: renaming it would leave the plan
   *  expecting a file nobody will create, and a resumed run once judged 64
   *  criteria red for exactly that — every check present, every one at the
   *  address the plan no longer used. */
  alreadyWritten: ReadonlySet<string> = new Set(),
): { from: string; to: string }[] {
  const idiom = inferTestIdiom(repoFiles);
  if (!idiom) return [];
  const runnable = testRootsOf(repoFiles);
  const moved: { from: string; to: string }[] = [];
  // Every address already spoken for: what the repository holds, and what
  // the slices before this one have just been given. A check this cut
  // ALREADY WROTE is not among them — that address is its own, and minting
  // onto it is the same check coming back rather than a collision.
  const taken = new Set<string>(repoFiles.filter((f) => f && !alreadyWritten.has(f)));
  for (const s of slices) {
    const units = s.workUnits ?? s.units ?? [];
    // Beside CODE, never beside a document: a check minted next to a
    // markdown file at the repository root was a home no test here has,
    // and the tester that put it somewhere sensible was refused for it.
    //
    // And beside code the repository can RUN a test for. A slice whose
    // work spans two trees — a view under webview/, its host under src/ —
    // used to take whichever file came first, so a check could be minted
    // into a tree no build compiles. It emitted no runnable file, matched
    // nothing the runner looked at, and failed a unit whose code was
    // correct; the fix was a build configuration no worker is cleared for.
    // The subject is chosen from a runnable root when the slice touches
    // one, and only otherwise from anywhere.
    const codeFiles = units
      .filter((u) => (u.role ?? "code") === "code")
      .flatMap((u) => u.footprint)
      .filter((f) => !isTestPath(f) && CODE.test(f));
    const subject =
      codeFiles.find((f) => runnable.includes(f.split("/")[0])) ?? codeFiles[0];
    if (!subject) continue;
    for (const u of units) {
      if ((u.role ?? "code") !== "test") continue;
      u.footprint = u.footprint.map((f) => {
        const k = /_AC-(\d+)/.exec(f)?.[1];
        if (!isProbePath(f) || !k || alreadyWritten.has(f)) return f;
        const to = nextFreeIn(taken, idiom, subject, Number(k));
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

/**
 * Keep every check at the address its delivery record names.
 *
 * The record binds each CRITERION to the file that proves it. The plan
 * binds a criterion to a probe by its ordinal — the `_AC-k` in the file's
 * own name against the k-th criterion the slice carries. Where the record
 * knows a criterion's check and that file is still on the branch, the
 * plan's minted address gives way: the work that exists wins over the
 * name a regrouped plan invented for it.
 *
 * Returns what moved, for the log.
 */
export function pinRecordedChecks(
  slices: readonly SliceLike[],
  recorded: ReadonlyMap<string, string>,
  onBranch: ReadonlySet<string>,
): { from: string; to: string }[] {
  if (!recorded.size) return [];
  const moved: { from: string; to: string }[] = [];
  for (const s of slices) {
    const ids = (s as { criterionIds?: string[] }).criterionIds ?? [];
    for (const u of s.workUnits ?? s.units ?? []) {
      if ((u.role ?? "code") !== "test") continue;
      u.footprint = u.footprint.map((f) => {
        const k = /_AC-(\d+)\./.exec(f)?.[1];
        const cid = k ? ids[Number(k) - 1] : undefined;
        const home = cid ? recorded.get(cid) : undefined;
        if (!home || home === f || !onBranch.has(home)) return f;
        moved.push({ from: f, to: home });
        return home;
      });
      if (u.cleared)
        u.cleared = u.cleared.map((c) => {
          const hit = moved.find((m) => m.from === c.path);
          return hit ? { ...c, path: hit.to } : c;
        });
    }
    if (s.files) s.files = s.files.map((f) => moved.find((m) => m.from === f)?.to ?? f);
  }
  return moved;
}

/**
 * The source roots where the repository keeps tests it actually runs.
 *
 * A repository compiles and runs one tree, not every tree it contains.
 * Here the suite is `tsc -p tsconfig.test.json && … && node --test
 * out-test/`, and that config includes `src` — so a check written under
 * `webview/map/src/` is compiled by nothing, emits no `.js`, and matches
 * nothing the runner looks at. It cannot fail, because it never runs.
 *
 * The roots are read from the repository rather than assumed: wherever it
 * already keeps a test of its own, a new one can live too.
 */
function testRootsOf(repoFiles: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const f of repoFiles)
    if (f && isTestPath(f) && !isProbePath(f)) roots.add(f.split("/")[0]);
  return [...roots].sort();
}

/**
 * Checks born where the repository runs no test of its own — refused
 * before dispatch, naming the roots that do run.
 *
 * The cost of not refusing: a unit whose production code was correct and
 * whose checks were sound was failed anyway, because those checks sat in
 * a tree no build compiles. The worker could not fix it — the fix is a
 * build configuration outside any worker's clearance — so it declared
 * UNDELIVERED, the closer stopped, and five maintainers blocked behind it.
 *
 * A repository that keeps no tests at all refuses nothing: there is no
 * evidence to judge a placement against, and inventing one would refuse
 * every check in a repository whose first test this run is writing.
 */
export function unreachableCheckHomes(
  slices: readonly { handle: string; workUnits?: { role?: string; footprint: string[] }[] }[],
  repoFiles: readonly string[],
): { where: string[]; roots: string[] } {
  const roots = testRootsOf(repoFiles);
  if (!roots.length) return { where: [], roots };
  const where: string[] = [];
  for (const s of slices)
    for (const u of s.workUnits ?? [])
      for (const f of u.footprint)
        if (isTestPath(f) && !roots.includes(f.split("/")[0])) where.push(`${s.handle}: ${f}`);
  return { where: [...new Set(where)], roots };
}
