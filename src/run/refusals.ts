/**
 * What the machine refuses before it dispatches anybody.
 *
 * Every expensive failure of the worst week was decided before a worker
 * started and discovered an hour into the run: a promise whose only
 * implementation site sat in another unit's clearance, a promise reaching
 * into two repositories, a plan that left the seam between its parts for
 * the last gate to find.
 *
 * A refusal here costs one reading of one sentence, at a moment when the
 * plan is the only thing that exists. The same fault found during the run
 * costs an hour and a person's attention, which is the number this whole
 * design is judged by.
 *
 * Each refusal names the PROMISE, in the person's own words — never a file,
 * a unit, or an internal of the run.
 */
import type { SliceForDag } from "../engine/core/dag";
import type { Change, Space } from "../core/schema";
import { isTestPath } from "./testHomes";
import { classMethodsIn, exportedIn, wrongAltitude } from "./altitude";
import { orderCoupledSlices, usesByFile } from "./coupling";
import type { ClassMethod } from "./altitude";
import type { Cut } from "../core/schema";
import { buildUnitDag } from "../engine/core/dag";
import { validateDag } from "../engine/methodology/parallelSlices";
import { coderTestPaths } from "./plan";
import { pinRecordedChecks, rehouseChecks, unreachableCheckHomes } from "./checkHomes";
import { verifyCutSignature } from "../gates/sign";

interface SliceLike extends SliceForDag {
  criterionIds?: string[];
}

/** The promises a slice is responsible for, from the criteria it carries. */
function promisesOf(slice: SliceLike, space: Space): Change[] {
  const ids = new Set(slice.criterionIds ?? []);
  return space.nodes.filter((n) => n.acceptance.some((a) => ids.has(a.id)));
}

/** What a slice's code units are cleared to write — production only. */
function clearanceOf(slice: SliceForDag): string[] {
  return slice.workUnits
    .filter((u) => (u.role ?? "code") !== "test")
    .flatMap((u) => u.footprint)
    .filter((p) => !isTestPath(p));
}

/**
 * Two slices that each use something the other owns.
 *
 * This was a refusal: no order exists, so build it as one piece of work.
 * That was too strong, and it refused a plan that had already run and
 * delivered twenty-two of its twenty-four promises. A slice commits when
 * it finishes, so the second of a coupled pair does see the first's work
 * — the coupling is a risk to watch, not an impossibility.
 *
 * It is also not what the sentence claimed. The two files named are the
 * USER side of two different edges pointing opposite ways; neither
 * imports the other, and a reader sent to look at them found nothing.
 *
 * So it is said and watched. The ordering repair still adds every edge it
 * can derive; what is left over is reported, and the run decides by
 * running.
 */
export function knotWarnings(knots: readonly { a: string; b: string; one: string; other: string }[]): string[] {
  return knots.map(
    (k) =>
      `${k.a} and ${k.b} each use something the other owns (${k.one}, ${k.other}) — whichever runs second sees the ` +
      `first's work only once it is committed. Watched, not refused.`,
  );
}

/**
 * The refusals, in the order a reader would want them: what cannot be
 * built at all, then what cannot be proven, then what is merely ordered
 * badly.
 *
 * Returns one sentence per refusal, or nothing when the plan can run.
 */
function refusalsBeforeDispatch(a: {
  slices: SliceForDag[];
  space: Space;
  /** Every class method this repository has, from the code map. Empty when
   *  no map is available — an unavailable reading is never a refusal. */
  methods?: readonly ClassMethod[];
  /** Whether a name is something a module hands out. */
  exported?: (symbol: string) => boolean;
}): string[] {
  const out: string[] = [];
  const slices = a.slices as SliceLike[];


  for (const s of slices) {
    const cleared = clearanceOf(s);
    for (const promise of promisesOf(s, a.space)) {
      // A promise that reaches into two repositories cannot be delivered by
      // one run: each repository has its own branch and its own delivery.
      const scopes = [
        ...new Set(
          (promise.grounding?.touchpoints ?? [])
            .map((t) => t.scope ?? "")
            .filter(Boolean),
        ),
      ];
      if (scopes.length > 1)
        out.push(
          `"${promise.sentence}" lands in more than one repository (${scopes.join(", ")}). ` +
            `A promise belongs to one repository, because each one is delivered on its own branch and accepted on its own. ` +
            `Split it into one promise per repository.`,
        );

      // A criterion that can only be checked by building a class and
      // calling it is at the wrong altitude: its check passes whether or
      // not the product ever reaches that code.
      if (a.methods?.length)
        for (const c of promise.acceptance) {
          if (c.kind === "assessment") continue;
          const why = wrongAltitude({
            criterion: c.text,
            methods: a.methods,
            exported: a.exported ?? (() => false),
          });
          if (why) out.push(`"${c.text}" — the check for "${promise.sentence}" — ${why}`);
        }

      // The site a promise names must be inside the clearance of the unit
      // responsible for it. Otherwise the unit is asked to keep a promise
      // it cannot reach, and discovers it four rounds in.
      // Every place the promise lands, minus the files its slice only
      // READS — a declared read is not a site, and needs no clearance.
      const reads = new Set(
        s.workUnits.flatMap((u) => [
          ...((u as { reads?: string[] }).reads ?? []),
          ...((u as { consumes?: string[] }).consumes ?? []),
        ]),
      );
      const sites = (promise.grounding?.touchpoints ?? [])
        .map((t) => t.path)
        .filter((p) => !isTestPath(p) && !reads.has(p));
      const unreachable = sites.filter(
        (p) => !cleared.some((c) => c === p || p.startsWith(c.replace(/\/$/, "") + "/")),
      );
      if (sites.length && unreachable.length === sites.length)
        out.push(
          `"${promise.sentence}" is to be kept by work that may not change ${unreachable.join(", ")} — the only place it lands. ` +
            `The unit responsible for a promise must be cleared to change where the promise lands.`,
        );
    }
  }
  return out;
}

/**
 * Everything the run decides before it dispatches anybody, in one place:
 * where the checks are born, whether the plan holds together, whether any
 * promise is impossible, and whether what was signed is what is about to
 * run.
 *
 * Returns the refusal, or nothing. Each refusal names its trigger for the
 * ledger and says its reason in the person's own words.
 */
export async function refusedBeforeDispatch(a: {
  slices: SliceForDag[];
  space: Space;
  cut: Cut;
  repoRoot: string;
  /** The run's branch, whose earlier work may already hold the checks. */
  branch?: string;
  /** Check paths a delivery record holds for this cut: a consumed check is
   *  restored to its recorded address, so the plan must keep expecting it
   *  there — renaming it after a delivery once turned a fully proven cut
   *  into fifty-eight file-not-found reds. */
  recordedChecks?: readonly string[];
  /** Criterion → the address its check was recorded at. */
  recordedHomes?: Map<string, string>;
  graphPath?: string;
  exec: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
  log: (line: string) => void;
  /** The machine's own record — what the plan's shape costs is a fact
   *  about the slicing, which is the machine's, never the person's. */
  defect?: (e: { activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
}): Promise<{ dag: ReturnType<typeof buildUnitDag>; refusal?: { trigger: string; refusal: string } }> {
  // A check is born where this repository already keeps its tests, beside
  // the module it drives — so it imports its subject the same way before
  // and after the build, and nothing has to map one path to the other. A
  // check an earlier run of this branch already wrote keeps its address.
  const onBranch = a.branch
    ? (await a.exec("git", ["-C", a.repoRoot, "ls-tree", "-r", "--name-only", a.branch], a.repoRoot)).out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  // A check's identity is the CRITERION it proves, never the address one
  // plan happened to mint. A resumed run rebuilds its plan from the space,
  // and the space has moved under it — the run itself wrote records into
  // it — so the same promises regroup into different slices and every
  // check is minted a fresh address. One resume renamed six criteria's
  // checks out from under their finished work: the plan expected files
  // that did not exist, a tester wrote new checks beside the wrong module,
  // and the gate then graded six promises against checks that never drove
  // their subjects. The delivery record knows where each criterion's check
  // really lives; a recorded address that is still on the branch wins over
  // anything the new plan minted. Pinned BEFORE the rehousing: the true
  // ordinal is in the original probe's own name, and the rehouser shifts
  // ordinals when addresses are taken — reading the criterion off a
  // shifted name bound six checks to the wrong criteria all over again.
  const pinned = pinRecordedChecks(a.slices, a.recordedHomes ?? new Map(), new Set(onBranch));
  if (pinned.length)
    a.log(`${pinned.length} check(s) kept at their recorded address, e.g. ${pinned[0].to}`);

  const repoFiles = (await a.exec("git", ["-C", a.repoRoot, "ls-files"], a.repoRoot)).out
    .split("\n")
    .map((l) => l.trim());
  const rehoused = rehouseChecks(
    a.slices,
    repoFiles,
    new Set([...onBranch, ...(a.recordedChecks ?? [])]),
  );
  if (rehoused.length)
    a.log(`${rehoused.length} check(s) born in the repository's own test homes, e.g. ${rehoused[0].to}`);


  // Cross-slice order is derived from `needs` — the reading's own sentence
  // that one promise needs another. When the reading says it, the plan is
  // ordered; when it does not, two slices that change what the other calls
  // run side by side and neither can ever be proven. The map knows who
  // uses whom, and that settles the order without asking anybody, so the
  // edges are added here rather than the plan being sent back.
  const coupling = orderCoupledSlices(a.slices, a.graphPath ? usesByFile(a.graphPath) : new Map());
  for (const e of coupling.added)
    a.log(`plan: ${e.after} waits for ${e.before} — ${e.user} calls ${e.used}, so it is built against the finished shape`);
  for (const w of knotWarnings(coupling.knots)) a.log(`plan: ${w}`);

  // The plan's units are built AFTER the rehousing and the ordering, so
  // every unit carries the path its check is really born at and every edge
  // the map found.
  const dag = buildUnitDag(a.slices);
  const verdict = validateDag(dag) as { ok: boolean; error?: string };
  if (!verdict.ok)
    return { dag, refusal: { trigger: "plan-validation", refusal: `the engine refused the plan: ${JSON.stringify(verdict)}` } };

  // A check the repository's own build never compiles cannot fail, because
  // it never runs — and the unit holding it is failed for work that was
  // correct. The fix is a build configuration no worker is cleared for, so
  // the placement is refused here, before anybody spends a round on it.
  const stranded = unreachableCheckHomes(a.slices, repoFiles);
  if (stranded.where.length)
    return {
      dag,
      refusal: {
        trigger: "plan-check-homes",
        refusal:
          `these checks are born where this repository runs no test of its own, so nothing would compile or run them — ` +
          `refused before dispatch: ${stranded.where.join(", ")}. Its tests live under ${stranded.roots.join(", ")}.`,
      },
    };

  const misowned = coderTestPaths(a.slices);
  if (misowned.length)
    return {
      dag,
      refusal: {
        trigger: "plan-roles",
        refusal: `the plan hands a coder test-shaped paths — refused before dispatch: ${misowned.join(", ")}`,
      },
    };

  const reading = exportedIn(
    a.repoRoot,
    a.space.nodes.flatMap((n) => (n.grounding?.touchpoints ?? []).map((t) => t.path)),
  );
  // A file that is there and could not be read is a fault here. Left
  // silent, it answers "this name is not exported", removes the exemption
  // the altitude rule turns on, and the person's plan is refused for a
  // failed read. The rule is held back and the files are named instead.
  if (reading.unreadable.length)
    a.log(
      `⚠ ${reading.unreadable.length} file(s) a promise names could not be read, so the altitude rule ` +
        `is not applied to this cut: ${reading.unreadable.slice(0, 5).join(", ")}`,
    );
  const impossible = refusalsBeforeDispatch({
    slices: a.slices,
    space: a.space,
    methods: reading.unreadable.length ? [] : a.graphPath ? classMethodsIn(a.graphPath) : [],
    exported: reading.exported,
  });
  if (impossible.length) return { dag, refusal: { trigger: "plan-promises", refusal: impossible.join("\n") } };

  // What was signed is what runs. Only DRIFT is judged here; whether an
  // unsigned cut may run at all is the sign gate's question, asked earlier.
  const signed = a.cut.signature ? verifyCutSignature(a.space, a.cut) : { ok: true as const };
  if (signed.ok && "unchecked" in signed && signed.unchecked) a.log(signed.unchecked);
  if (!signed.ok)
    return {
      dag,
      refusal: {
        trigger: "signature-drift",
        refusal:
          signed.drift === "render"
            ? `the promises changed after they were signed (${signed.reason}) — read the cut again and sign what it says now`
            : `where the promises land changed after they were signed (${signed.reason}) — re-ground them and sign again`,
      },
    };
  return { dag };
}
