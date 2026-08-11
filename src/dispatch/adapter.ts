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

export function tepSlices({ space, cut, spaceName, handlePrefix }: TepSlicesArgs): SliceForDag[] {
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
    const touch = (plannedOnly: boolean): string[] => [
      ...new Set(
        changes.flatMap((c) =>
          (c.grounding?.touchpoints ?? [])
            .filter((t) => (plannedOnly ? t.planned : true))
            .map((t) => t.path)
            .filter((p) => soleOwned(p, sliceNo)),
        ),
      ),
    ];
    const planned = touch(true);
    return planned.length ? planned : touch(false);
  };

  return units.map((unit, idx) => {
    const no = idx + 1;
    const handle = `${handlePrefix ?? ""}SL-${no}`;
    const changes = unit.changeIds.map((id) => byId.get(id)!);
    const files = [
      ...new Set(
        changes.flatMap((c) => (c.grounding?.touchpoints ?? []).map((t) => t.path)),
      ),
    ];

    // The sharpest text the pipeline produced — sentences, where each
    // change lands, and what proves it (precision is monotone).
    const note = changes
      .map((c) => {
        const at = (c.grounding?.touchpoints ?? [])
          .map((t) => t.path + (t.symbol ? ` › ${t.symbol}` : "") + (t.planned ? " (new file)" : ""))
          .join(", ");
        const proofs = c.acceptance.map((a) => a.text).join("; ");
        return `${c.sentence}${at ? ` — lands at ${at}` : ""}${proofs ? ` — done when: ${proofs}` : ""}`;
      })
      .join("\n");

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
    const criteria = changes.flatMap((c) =>
      c.acceptance
        .filter((a) => a.kind !== "assessment")
        .map((a) => ({ change: c, text: a.text })),
    );
    const codeUnit: WorkUnit & { note?: string } = {
      footprint: files,
      execution: "serial",
      role: "code",
      note,
      ...(consumes.length ? { consumes } : {}),
      ...(reads.length ? { reads } : {}),
    };
    const testUnits: (WorkUnit & { note?: string })[] = criteria.map(
      (crit, k) => ({
        footprint: [
          `probes/${sanitize(spaceName)}__${handle}_AC-${k + 1}.test.mjs`,
        ],
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
      workUnits: [codeUnit, ...testUnits],
      satisfies: criteria.map((_, k) => k + 1),
      contract,
    };
  });
}
