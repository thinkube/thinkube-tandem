/**
 * The staged expansion pipeline (expansion redesign 2026-07-18).
 *
 * Replaces the single flat gap-filler round with a sequence where each stage
 * feeds the next and DERIVATION RECORDS ITS OWN EDGES:
 *
 *   1. elements   — per journal ENTRY (goal = entry 1), each element carries
 *                   servesEntry (its parking group).
 *   2. constraints — derived from the now-existing elements; each `requires`
 *                    the element(s) it bounds.
 *   3. gap        — the open unknowns per element; each `requires` its element.
 *   4. acceptance — success conditions per element; each `requires` its element.
 *
 * Stages 2–4 are given the live element list (ids + texts) so they can link.
 * The edges they record are what make the cut closure, the orphan check, and
 * the derived risk all work.
 *
 * Prompt builders are pure and exported for tests; the runner uses the same
 * createPhaseWorker/normalize seam as every other round.
 */

import type { Action, WorkingModel } from "../model";
import { renderActionGuide } from "./actionGuide";
import {
  createPhaseWorker,
  GATES,
  renderGroundingBlocks,
  type WorkerFactoryDeps,
  type WorkerRun,
} from "./worker";

export type ExpansionStage = "elements" | "constraints" | "gap" | "acceptance";

export const EXPANSION_STAGES: ExpansionStage[] = [
  "elements",
  "constraints",
  "gap",
  "acceptance",
];

/** The numbered journal (goal = entry 1), as the pipeline sees it. */
export function journalEntries(model: WorkingModel): string[] {
  const goal = model.sections.find((s) => s.kind === "goal")?.text.trim() ?? "";
  return [
    ...(goal ? [goal] : []),
    ...(model.roughRequests ?? []).map((r) => r.text),
  ];
}

/** Live elements (active), id + text, for stages 2–4 to link against. */
export function liveElements(
  model: WorkingModel,
): { id: string; text: string }[] {
  return model.sections
    .filter((s) => s.kind === "elements")
    .flatMap((s) => s.items)
    .filter((it) => it.state === "active")
    .map((it) => ({ id: it.id, text: it.text }));
}

function sectionId(model: WorkingModel, kind: ExpansionStage): string {
  return model.sections.find((s) => s.kind === kind)?.id ?? `<${kind}>`;
}

/**
 * All active item ids belonging to a journal-entry GROUP (parking unit,
 * 2026-07-18): the elements with servesEntry === entry, plus every active
 * non-element item reachable from them through requires edges — UNLESS that
 * item is also reachable from an element in ANOTHER group (shared context is
 * not parked out from under the groups that still need it).
 */
export function groupItemIds(model: WorkingModel, entry: number): string[] {
  const byId = new Map<
    string,
    { kind: string; item: WorkingModel["sections"][0]["items"][0] }
  >();
  for (const s of model.sections)
    for (const it of s.items) byId.set(it.id, { kind: s.kind, item: it });
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const { item } of byId.values())
    for (const req of item.requires ?? [])
      if (byId.has(req)) link(item.id, req);
  const isElement = (id: string): boolean => byId.get(id)?.kind === "elements";

  // The ELEMENTS a non-element item anchors to: reachable through requires
  // edges WITHOUT traversing through another element (elements are sinks —
  // otherwise everything is transitively connected through shared elements
  // and nothing is ever "private").
  const anchorElements = (start: string): string[] => {
    const anchors = new Set<string>();
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const cur = q.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        if (isElement(nb)) {
          anchors.add(nb); // sink — record, do not expand
        } else {
          q.push(nb);
        }
      }
    }
    return [...anchors];
  };

  const entryOf = (elementId: string): number | undefined =>
    byId.get(elementId)?.item.servesEntry;

  const parked = new Set<string>();
  // This group's elements.
  for (const [id, v] of byId.entries())
    if (
      v.kind === "elements" &&
      v.item.state === "active" &&
      v.item.servesEntry === entry
    )
      parked.add(id);
  // Non-element items whose anchor elements are ALL in this group (private).
  for (const [id, v] of byId.entries()) {
    if (v.kind === "elements" || v.kind === "goal") continue;
    if (v.item.state !== "active") continue;
    const anchors = anchorElements(id);
    if (
      anchors.length > 0 &&
      anchors.every((a) => entryOf(a) === entry)
    ) {
      parked.add(id);
    }
  }
  return [...parked];
}
/**
 * Build one stage's prompt. Stage 1 iterates the journal; stages 2–4 iterate
 * the elements. Every prompt names EXACTLY ONE target section so the round
 * stays focused, and (2–4) demands a `requires` edge to an element on every
 * item — the orphan rule enforced at the source.
 */
export function buildStagePrompt(
  stage: ExpansionStage,
  model: WorkingModel,
  contextDigest?: string,
): string {
  const entries = journalEntries(model);
  const grounding = renderGroundingBlocks(model, contextDigest);
  const journalBlock = entries
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");
  const guide = renderActionGuide(
    model,
    GATES.gapFiller.allowedTools,
    "gap-filler",
  );
  const secId = sectionId(model, stage);

  if (stage === "elements") {
    return (
      `You are STAGE 1 of the expansion pipeline: derive the ELEMENTS.\n\n` +
      `Elements are the SUBJECT MATTER — the concrete things the journal commits to BUILDING. ` +
      `They are the root everything else will hang off. Iterate the numbered journal below and, ` +
      `for EACH entry, propose the elements it commits to. Set "servesEntry" to that entry's number ` +
      `(the goal is entry 1) — this is the parking group.\n\n` +
      `Numbered journal (goal = entry 1):\n${journalBlock}` +
      grounding +
      `\n\nRules:\n` +
      `- Propose ONLY into the elements section ("${secId}"). Nothing else this stage.\n` +
      `- One element = one buildable thing. Sharp and few (roughly 2-5 per entry), not a wall.\n` +
      `- Stay at intent altitude — WHAT is built, never HOW (no languages, frameworks, endpoints).\n` +
      `- EVERY element carries "servesEntry" (its journal-entry number) and a "note" ` +
      `(Why / Impact / Modality, one sentence each).\n` +
      `- NEVER restate an existing item in any wording.\n\n` +
      guide
    );
  }

  const els = liveElements(model);
  const elementBlock =
    els.length > 0
      ? els.map((e) => `  - ${e.id}: ${e.text}`).join("\n")
      : "  (none yet — if there are no elements, propose nothing)";

  const stageSpec: Record<
    Exclude<ExpansionStage, "elements">,
    { title: string; what: string }
  > = {
    constraints: {
      title: "STAGE 2 of the expansion pipeline: derive the CONSTRAINTS",
      what:
        `A constraint is something that must HOLD or be respected — a boundary or invariant ` +
        `on one or more elements. Derive constraints FROM the elements above.`,
    },
    gap: {
      title: "STAGE 3 of the expansion pipeline: derive the GAPS",
      what:
        `A gap is an OPEN QUESTION / unknown that must be resolved before an element can be ` +
        `specified — the reason an element is not yet safe to build. It raises the element's risk. ` +
        `Derive the gaps each element carries.`,
    },
    acceptance: {
      title: "STAGE 4 of the expansion pipeline: derive the ACCEPTANCE criteria",
      what:
        `An acceptance item states a falsifiable condition that must be TRUE for an element to ` +
        `count as delivered — the definition of done. Derive acceptance FROM the elements. ` +
        `Do not split "what must be true" from "how to check it" — one statement of done per condition.`,
    },
  };
  const spec = stageSpec[stage];

  return (
    `You are ${spec.title}.\n\n${spec.what}\n\n` +
    `The ELEMENTS (the subject matter — link every item you propose to at least one of these):\n` +
    `${elementBlock}\n\n` +
    `Numbered journal for reference (goal = entry 1):\n${journalBlock}` +
    grounding +
    `\n\nRules:\n` +
    `- Propose ONLY into the ${stage} section ("${secId}"). Nothing else this stage.\n` +
    `- EVERY item MUST carry a "requires" edge naming the element id(s) it derives from ` +
    `(from the list above). An item that serves no element is an ORPHAN and will be rejected — ` +
    `so if you cannot tie it to an element, do not propose it.\n` +
    `- Sharp and few. Do not restate an existing item in any wording.\n` +
    `- EVERY item carries a "note" (Why / Impact / Modality, one sentence each).` +
    (stage === "constraints" || stage === "acceptance"
      ? ` Score "complexity" with its factor and a one-line "complexityRationale" when it is non-trivial.`
      : "") +
    `\n\n` +
    guide
  );
}

/**
 * A pipeline-stage worker: the gap-filler gate, but its prompt is the
 * stage-specific derivation (buildStagePrompt). One target section per stage.
 */
export function expansionStageWorker(
  stage: ExpansionStage,
  deps: WorkerFactoryDeps,
): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.gapFiller.allowedTools,
    disallowedTools: GATES.gapFiller.disallowedTools,
    actor: "gap-filler",
  });
  return {
    ...base,
    buildPrompt(model: WorkingModel, _conversation: string[]): string {
      return buildStagePrompt(stage, model, deps.contextDigest);
    },
    async run(model: WorkingModel, conversation: string[]): Promise<Action[]> {
      return base.run(model, conversation);
    },
  };
}

/**
 * Build the ORPHAN-REPAIR prompt (self-repair 2026-07-18): given the orphans
 * the integrity gate found and the live elements, the worker either links an
 * orphan to the element it serves (linkItems) or promotes a mislabeled orphan
 * into elements (reclassifyItem). It never drops — genuine noise stays flagged
 * for the human.
 */
export function buildRepairPrompt(
  model: WorkingModel,
  orphans: { id: string; kind: string; text: string }[],
): string {
  const els = liveElements(model);
  const elementBlock =
    els.length > 0
      ? els.map((e) => `  - ${e.id}: ${e.text}`).join("\n")
      : "  (no elements)";
  const orphanBlock = orphans
    .map((o) => `  - ${o.id} [${o.kind}]: ${o.text}`)
    .join("\n");
  const guide = renderActionGuide(model, GATES.repair.allowedTools, "integrator");
  return (
    `You are the ORPHAN-REPAIR round. Each orphan below is tied to NO element — ` +
    `the pipeline's own mistake. Heal each one:\n\n` +
    `ELEMENTS:\n${elementBlock}\n\nORPHANS:\n${orphanBlock}\n\n` +
    `For EACH orphan, choose exactly one:\n` +
    `- If it genuinely serves one of the elements above (it is a real constraint / gap / ` +
    `acceptance about that element), emit linkItems adding the requires edge to that element id.\n` +
    `- If the orphan is ITSELF a buildable thing (an element mislabeled — e.g. a deliverable ` +
    `sitting in constraints), emit reclassifyItem moving it to "elements" with servesEntry set ` +
    `to the journal entry it belongs to.\n` +
    `Do NOT invent elements or drop anything. If an orphan fits neither, leave it (the human decides).\n\n` +
    guide
  );
}

export function repairWorker(deps: WorkerFactoryDeps & { orphans: { id: string; kind: string; text: string }[] }): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.repair.allowedTools,
    disallowedTools: GATES.repair.disallowedTools,
    actor: "integrator",
  });
  return {
    ...base,
    buildPrompt(model: WorkingModel): string {
      return buildRepairPrompt(model, deps.orphans);
    },
    async run(model: WorkingModel, conversation: string[]): Promise<Action[]> {
      return base.run(model, conversation);
    },
  };
}
