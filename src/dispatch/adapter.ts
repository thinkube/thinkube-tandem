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
}

export function tepSlices({ space, cut, spaceName }: TepSlicesArgs): SliceForDag[] {
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

  const producedBy = (sliceNo: number): string[] => {
    const changes = units[sliceNo - 1].changeIds.map((id) => byId.get(id)!);
    const planned = changes.flatMap((c) =>
      (c.grounding?.touchpoints ?? []).filter((t) => t.planned).map((t) => t.path),
    );
    if (planned.length) return [...new Set(planned)];
    return [
      ...new Set(
        changes.flatMap((c) => (c.grounding?.touchpoints ?? []).map((t) => t.path)),
      ),
    ];
  };

  return units.map((unit, idx) => {
    const no = idx + 1;
    const handle = `SL-${no}`;
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

    const criteria = changes.flatMap((c) =>
      c.acceptance.map((a) => ({ change: c, text: a.text })),
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
        execution: "fan-out",
        role: "test",
        note: `[${crit.change.sentence}] ${crit.text}`,
      }),
    );

    const contract = changes
      .map(
        (c) =>
          `${c.sentence}${
            c.grounding
              ? ` — lands at ${(c.grounding.touchpoints ?? [])
                  .map((t) => t.path + (t.symbol ? ` › ${t.symbol}` : ""))
                  .join(", ")}`
              : ""
          }`,
      )
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
