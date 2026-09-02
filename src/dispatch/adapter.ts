/**
 * The adapter — the ONLY new code that faces the engine. A signed TEP's
 * changes become slices in exactly the shape the imported scheduler eats
 * (`SliceForDag`): one coder unit per slice with the sharpest note the
 * pipeline produced, one held-out test unit per acceptance criterion with
 * a space-namespaced probe footprint, `consumes` edges derived from
 * cross-slice needs, and the contract injected verbatim. Enrichment lives
 * only inside fields the engine already threads; engine code is never
 * edited to fit (the engine-hash gate enforces that).
 */
import { Change, Cut, Space } from "../core/schema";
import { formUnits } from "../core/cluster";
import type { SliceForDag } from "../engine/core/dag";
import type { WorkUnit } from "../engine/orchestratorCore";
import type { PlannedChange } from "../run/clearance";
import { isTestPath } from "../run/testHomes";

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export interface TepSlicesArgs {
  space: Space;
  cut: Cut;
  /** The thinking space's name — probe identity carries it (numbers repeat
   *  across spaces; the collision lesson). */
  spaceName: string;
  /** Scope qualifier for slice handles — a multi-scope TEP dispatches one
   *  batch per repo and their unit ids must never collide. */
  handlePrefix?: string;
}

/** The engine's slice, plus the space's own bookkeeping the engine never
 *  reads: which criterion each check ordinal stands for. The event side
 *  keeps the mapping; nothing delivery-shaped enters the test files. */
export type TandemSlice = SliceForDag & {
  /** Criterion id per check ordinal (index k ↔ AC-(k+1)). */
  criterionIds: string[];
  /** A maintain slice: brings its parent slice's test homes under, after the
   *  code they import has landed; its checks are its parent's probes. */
  maintains?: string;
};

export function tepSlices({ space, cut, spaceName, handlePrefix }: TepSlicesArgs): TandemSlice[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const members = cut.changeIds
    .map((id) => byId.get(id))
    .filter((c): c is Change => !!c);
  // Repo containment: a touchpoint that escapes the scope's repository can
  // never be dispatched — refuse before the engine sees the plan.
  const escaping = members.flatMap((c) =>
    (c.grounding?.touchpoints ?? [])
      .map((t) => t.path)
      .filter((p) => p.startsWith("/") || p.split("/").includes("..")),
  );
  if (escaping.length)
    throw new Error(
      `touchpoint(s) escape the repository: ${[...new Set(escaping)].join(", ")} — re-ground with repo-relative paths`,
    );
  const units = formUnits(members);
  const sliceOf = new Map<string, number>();
  units.forEach((u, i) => u.changeIds.forEach((id) => sliceOf.set(id, i + 1)));

  // Who owns a file. A dependency is declared as a FILE and the engine
  // resolves it to EVERY unit whose footprint holds it — so a file two
  // units touch names them both, and a consumer gains an edge onto work
  // nobody pointed it at. Those phantom edges can point in circles, and
  // the engine then refuses the whole plan rather than one unit.
  const owners = new Map<string, Set<number>>();
  units.forEach((u, i) =>
    u.changeIds
      .flatMap((id) => (byId.get(id)?.grounding?.touchpoints ?? []).map((t) => t.path))
      .forEach((f) => owners.set(f, (owners.get(f) ?? new Set()).add(i + 1))),
  );
  const soleOwned = (p: string, sliceNo: number): boolean =>
    owners.get(p)?.size === 1 && !!owners.get(p)?.has(sliceNo);

  /** How a slice names itself to whatever depends on it: files it alone
   *  owns, so the edge lands on it and on nothing else. Unit formation
   *  guarantees a producer of a cross-unit edge has at least one. */
  const producedBy = (sliceNo: number): string[] => {
    const changes = units[sliceNo - 1].changeIds.map((id) => byId.get(id)!);
    // A slice names itself by production it alone owns — never by a test
    // home, whose keeper is the maintain slice, later.
    const touch = (plannedOnly: boolean): string[] => [
      ...new Set(
        changes.flatMap((c) =>
          (c.grounding?.touchpoints ?? [])
            .filter((t) => (plannedOnly ? t.planned : true))
            .map((t) => t.path)
            .filter((p) => !isTestPath(p) && soleOwned(p, sliceNo)),
        ),
      ),
    ];
    const planned = touch(true);
    return planned.length ? planned : touch(false);
  };

  const maintain: { of: string; sentences: string[]; production: string[]; testHomes: string[]; testHomeWork: { path: string; sentence: string; criteria: string[] }[] }[] = [];
  const main = units.map((unit, idx) => {
    const no = idx + 1;
    const handle = `${handlePrefix ?? ""}SL-${no}`;
    const changes = unit.changeIds.map((id) => byId.get(id)!);
    const files = [
      ...new Set(
        changes.flatMap((c) => (c.grounding?.touchpoints ?? []).map((t) => t.path)),
      ),
    ];
    // Roles own paths: production to the coder, every test-shaped path to
    // the tester — who brings existing test homes under the criteria before
    // the code exists. The coder never holds a test in its footprint.
    const production = files.filter((f) => !isTestPath(f));
    const testHomes = files.filter((f) => isTestPath(f));
    files.splice(0, files.length, ...production);

    // The sharpest text the pipeline produced — sentences, where each
    // change lands, and what proves it (precision is monotone). The coder's
    // note names production landings only; test landings are the tester's.
    const note = changes
      .map((c) => {
        const at = (c.grounding?.touchpoints ?? [])
          .filter((t) => !isTestPath(t.path))
          .map((t) => t.path + (t.symbol ? ` › ${t.symbol}` : "") + (t.planned ? " (new file)" : ""))
          .join(", ");
        const proofs = c.acceptance.map((a) => a.text).join("; ");
        return `${c.sentence}${at ? ` — lands at ${at}` : ""}${proofs ? ` — done when: ${proofs}` : ""}`;
      })
      .join("\n");
    // What each test home is FOR — the tester's brief for bringing it under.
    const testHomeWork = changes.flatMap((c) =>
      (c.grounding?.touchpoints ?? [])
        .filter((t) => isTestPath(t.path))
        .map((t) => ({
          path: t.path,
          sentence: c.sentence + (t.symbol ? ` (${t.symbol})` : ""),
          criteria: c.acceptance.map((a) => a.text),
        })),
    );

    // Cross-slice needs → the engine's only edge language: consumes over
    // the producing slice's footprint (planned outputs first).
    const consumes = [
      ...new Set(
        changes.flatMap((c) =>
          c.needs
            .map((needId) => sliceOf.get(needId))
            .filter((s): s is number => s !== undefined && s !== no)
            .flatMap((s) => producedBy(s)),
        ),
      ),
    ];

    // Shared non-planned touchpoints landing in ANOTHER slice's footprint
    // and not already consumed — the declared cross-slice read set.
    const consumed = new Set(consumes);
    const reads = [
      ...new Set(
        changes.flatMap((c) =>
          (c.grounding?.touchpoints ?? [])
            .filter((t) => !t.planned)
            .map((t) => t.path)
            .filter((p) => {
              if (consumed.has(p)) return false;
              const owner = [...sliceOf.entries()].some(
                ([cid, s]) =>
                  s !== no &&
                  (byId.get(cid)?.grounding?.touchpoints ?? []).some(
                    (t) => t.planned && t.path === p,
                  ),
              );
              return owner;
            }),
        ),
      ),
    ];

    // Assessment checks get NO probe order — no runnable test fits them
    // by definition; the closing gate grades them with a fresh assessor.
    // A criterion settled elsewhere gets none either: its answer comes
    // from the pipeline, the cluster, or a person, after the merge — a
    // here-shaped check for it fails on the machine's limits and blames
    // the work.
    const criteria = changes.flatMap((c) =>
      c.acceptance
        .filter((a) => a.kind !== "assessment" && !a.settledBy)
        .map((a) => ({ change: c, id: a.id, text: a.text })),
    );
    // What the plan says this unit will DO to each file, not merely which
    // paths it may write: a touchpoint the grounding marks as planned is a
    // file to create, anything else is a file to change (docs/WORDS.md).
    // The bare path list below is a projection of this, because git and the
    // guard take paths.
    const planned = new Set(
      changes.flatMap((c) => (c.grounding?.touchpoints ?? []).filter((t) => t.planned).map((t) => t.path)),
    );
    const cleared: PlannedChange[] = production.map((path) => ({
      action: planned.has(path) ? ("create" as const) : ("change" as const),
      path,
    }));
    const codeUnit: WorkUnit & { note?: string; cleared?: PlannedChange[] } = {
      footprint: production,
      cleared,
      execution: "serial",
      role: "code",
      note,
      ...(consumes.length ? { consumes } : {}),
      ...(reads.length ? { reads } : {}),
    };
    // Testers write probes — one per criterion, held out, tests-first.
    const testUnits: (WorkUnit & { note?: string })[] = criteria.map(
      (crit, k) => ({
        footprint: [`probes/${sanitize(spaceName)}__${handle}_AC-${k + 1}.test.mjs`],
        cleared: [{ action: "create" as const, path: `probes/${sanitize(spaceName)}__${handle}_AC-${k + 1}.test.mjs` }],
        // SERIAL, not fan-out: the engine gives every fan-out test unit its
        // own worker and batches serial ones into a single warm session per
        // slice. Fan-out made the run's size track the number of checks —
        // 238 checks became 238 Claude Code processes. Serial keeps every
        // probe file and its AC ordinal exactly as they were, and asks one
        // worker to write them.
        execution: "serial",
        role: "test",
        note: `[${crit.change.sentence}] ${crit.text}`,
      }),
    );
    // The slice's test homes are brought under by a MAINTAIN slice of their
    // own (appended after every production slice, below): scheduled after
    // the code its tests import, worked as a tester, never batched with the
    // coder, committed on its own once the code has landed.
    if (testHomes.length) maintain.push({ of: handle, sentences: changes.map((c) => c.sentence), production, testHomes, testHomeWork });

    // THE CONTRACT: the seam this slice introduces, by name.
    //
    // The engine unions every slice's contract and stamps it on every
    // unit, so a coder and its held-out tester agree on an interface
    // without consuming each other — and two slices cannot each invent
    // the same missing helper under two names, which is what happens
    // when they run in parallel with disjoint footprints and nothing
    // shared to build against.
    //
    // What makes it a contract is that it carries NAMES. A description of
    // what a slice is doing, however well written, is something a worker
    // can read and still has to guess at; a symbol is something it can
    // call.
    const seam = (planned: boolean): string[] => [
      ...new Set(
        changes.flatMap((c) =>
          (c.grounding?.touchpoints ?? [])
            .filter((t) => !!t.symbol && !!t.planned === planned)
            .map((t) => `  - ${t.path} › ${t.symbol}`),
        ),
      ),
    ];
    const introduces = seam(true);
    const changesSymbols = seam(false);
    const contract = [
      introduces.length ? `${handle} INTRODUCES (does not exist yet — call it by this name):` : "",
      ...introduces,
      changesSymbols.length ? `${handle} CHANGES (exists today):` : "",
      ...changesSymbols,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      handle,
      status: "ready",
      files,
      // A slice whose every landing is a test home has no coder to spend.
      workUnits: [...(production.length ? [codeUnit] : []), ...testUnits],
      satisfies: criteria.map((_, k) => k + 1),
      criterionIds: criteria.map((c) => c.id),
      contract,
    };
  });
  // One maintain slice per production slice with test homes: its unit is
  // code-role (so no tests-first rule makes anything wait on it), its own
  // execution unit, consuming — bound at run time from the code graph — the
  // production its test homes import; it carries its parent's probes as
  // its checks, so the tree it leaves builds and the parent's promises
  // still hold.
  const extra: TandemSlice[] = maintain.map((m) => ({
    // Named for the slice it serves: "SL-5-tests" brings SL-5's tests under.
    handle: `${m.of}-tests`,
    status: "ready",
    files: m.testHomes,
    workUnits: [
      {
        footprint: m.testHomes,
      cleared: m.testHomes.map((path: string) => ({ action: "change" as const, path })),
        execution: "serial",
        role: "code",
        // Said in the promises' own words, as a tester's brief is: the
        // card wears the promise, and no slice id reaches a person.
        note: m.sentences.map((s) => `[${s}] The tests that already exist are brought under it.`).join("; "),
        // Always after its parent's code — graph or no graph, new file or
        // old — plus whatever else the graph adds at run start.
        ...(m.production.length ? { consumes: m.production } : {}),
        testHomeWork: m.testHomeWork,
      } as WorkUnit & { note?: string; testHomeWork?: typeof m.testHomeWork },
    ],
    satisfies: [],
    criterionIds: [],
    contract: "",
    maintains: m.of,
  }));
  return [...main, ...extra];
}