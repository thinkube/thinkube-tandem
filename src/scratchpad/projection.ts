import type { SectionKind, Tenant, WorkingModel } from "./model";
import { goalSection } from "./model";

/**
 * The frozen status written to the signing tool for TEP artifacts.
 */
export const FROZEN_TEP_STATUS: "proposed" = "proposed";

/**
 * Maps each SectionKind to its canonical TEP section header.
 * Headers not listed here have no section-kind mapping and will appear empty.
 */
const KIND_TO_TEP_HEADER: Partial<Record<SectionKind, string>> = {
  goal: "## Goal",
  criteria: "## User Expectation",
  constraints: "## Context",
  elements: "## Detailed Description",
  gap: "## Alternatives Considered",
  verification: "## Implemented By",
};

/**
 * Canonical TEP headers in display order.
 */
const TEP_ORDERED_HEADERS: readonly string[] = [
  "## Goal",
  "## User Expectation",
  "## Context",
  "## Decision",
  "## Detailed Description",
  "## Consequences",
  "## Alternatives Considered",
  "## Implemented By",
];

/**
 * Tenant-parameterized projection of the settled working model into artifact markdown.
 *
 * For the 'tep' tenant: begins `# TEP — <goal title>` and contains the canonical
 * TEP headers (## Goal, ## User Expectation, ## Context, ## Decision,
 * ## Detailed Description, ## Consequences, ## Alternatives Considered, ## Implemented By),
 * populated from the settled sections.
 *
 * Any unresolved objection is listed under a final `## Unresolved Objections` heading
 * (one bullet each).
 */
export function project(model: WorkingModel, tenant: Tenant): string {
  const goal = goalSection(model);
  const goalTitle = goal.text.split("\n")[0].trim() || "Untitled";

  if (tenant === "tep") {
    return _projectTep(model, goalTitle);
  }

  // Spec tenant — general seam, not fully wired yet.
  return _projectSpec(model, goalTitle);
}

function _projectTep(model: WorkingModel, goalTitle: string): string {
  // Build a lookup: canonical header → settled section text
  const headerContent = new Map<string, string>();
  for (const section of model.sections) {
    if (section.state === "settled") {
      const header = KIND_TO_TEP_HEADER[section.kind];
      if (header) {
        headerContent.set(header, section.text);
      }
    }
  }

  const lines: string[] = [];
  lines.push(`# TEP — ${goalTitle}`);

  for (const header of TEP_ORDERED_HEADERS) {
    lines.push("");
    lines.push(header);
    const content = headerContent.get(header);
    if (content) {
      lines.push("");
      lines.push(content);
    }
  }

  const unresolved = model.objections.filter((o) => !o.resolved);
  if (unresolved.length > 0) {
    lines.push("");
    lines.push("## Unresolved Objections");
    lines.push("");
    for (const obj of unresolved) {
      lines.push(`- ${obj.text}`);
    }
  }

  return lines.join("\n");
}

function _projectSpec(model: WorkingModel, goalTitle: string): string {
  const lines: string[] = [];
  lines.push(`# Spec — ${goalTitle}`);

  for (const section of model.sections) {
    if (section.state === "settled") {
      lines.push("");
      lines.push(
        `## ${section.kind.charAt(0).toUpperCase()}${section.kind.slice(1)}`,
      );
      lines.push("");
      lines.push(section.text);
    }
  }

  const unresolved = model.objections.filter((o) => !o.resolved);
  if (unresolved.length > 0) {
    lines.push("");
    lines.push("## Unresolved Objections");
    lines.push("");
    for (const obj of unresolved) {
      lines.push(`- ${obj.text}`);
    }
  }

  return lines.join("\n");
}

/**
 * Delta projection (SP-21/3 contract, part 4): the checked, still-active items —
 * never shipped, never deferred, never anything unchecked — grouped by section
 * kind, as the body of the NEXT frozen TEP. A superseding item's line carries
 * "(supersedes <the shipped item's text>)" so the revision is recorded in the
 * artifact itself. Returns the item ids so the freeze pipeline can stamp them
 * shipped once the write lands.
 */
/** Eval annotation for a projected item line — present only when scores are
 *  set, so pre-eval spaces and probe fixtures project byte-identically. */
function evalSuffix(it: {
  evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 };
  evalFactors?: { complexity?: string; risk?: string };
}): string {
  const parts: string[] = [];
  if (it.evals.complexity !== undefined) {
    parts.push(
      `complexity ${it.evals.complexity}${it.evalFactors?.complexity ? ` [${it.evalFactors.complexity}]` : ""}`,
    );
  }
  if (it.evals.risk !== undefined) {
    parts.push(
      `risk ${it.evals.risk}${it.evalFactors?.risk ? ` [${it.evalFactors.risk}]` : ""}`,
    );
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** A crisp title: the curated title when present, else the first line
 *  clipped to 80 characters (2026-07-17: the draft header carried the whole
 *  intent — a title is a headline, not a paragraph). */
function projectionTitle(model: WorkingModel, intentSource: string): string {
  if (model.curatedTitle?.trim()) return model.curatedTitle.trim();
  const firstLine = (intentSource.split("\n")[0] ?? "").trim();
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 79)}…`;
}

export function projectDelta(model: WorkingModel): {
  title: string;
  body: string;
  itemIds: string[];
} {
  const goal = goalSection(model);
  // The curated intent (2026-07-16 redesign) is what freeze signs as the
  // TEP's intent; the raw goal text is the fallback for pre-redesign spaces.
  const intentSource = model.curatedIntent?.trim() || goal.text;
  const title = projectionTitle(model, intentSource);
  const itemIds: string[] = [];
  const parts: string[] = [];
  const textById = new Map<string, string>();
  for (const s of model.sections)
    for (const it of s.items ?? []) textById.set(it.id, it.text);
  for (const s of model.sections) {
    const picked = (s.items ?? []).filter(
      (it) => it.checked && it.state === "active",
    );
    if (picked.length === 0) continue;
    const header = KIND_TO_TEP_HEADER[s.kind];
    if (header) parts.push(header);
    for (const it of picked) {
      itemIds.push(it.id);
      const sup = it.supersedes
        ? ` (supersedes ${textById.get(it.supersedes) ?? it.supersedes})`
        : "";
      parts.push(`- ${it.text}${sup}${evalSuffix(it)}`);
    }
    parts.push("");
  }
  return { title, body: parts.join("\n").trim(), itemIds };
}

/**
 * Project a CUT (2026-07-16 redesign): the selected elements plus the context
 * items their dependency edges pull in (transitive closure over `requires` in
 * BOTH directions, but only ever pulling NON-element items as context — other
 * elements never join a cut implicitly).
 *
 * Returns:
 *   shipIds — selected elements (checked+active): consumed by the TEP.
 *   flagIds — pulled context (checked+active): flagged, stays live.
 *   uncheckedElements — selected but unsettled: freeze must refuse on these.
 */
export function projectCut(
  model: WorkingModel,
  cut: { elementIds: readonly string[]; intent?: string },
): {
  title: string;
  body: string;
  shipIds: string[];
  flagIds: string[];
  uncheckedElements: string[];
  /** EVERY context item the edges pull in, checked or not — the view marks
   *  them so "N context pulled" is visible on the rows themselves. */
  contextIds: string[];
} {
  const byId = new Map<
    string,
    { kind: SectionKind; item: WorkingModel["sections"][0]["items"][0] }
  >();
  for (const s of model.sections)
    for (const it of s.items) byId.set(it.id, { kind: s.kind, item: it });

  // Undirected adjacency over requires edges.
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const { item } of byId.values())
    for (const req of item.requires ?? []) link(item.id, req);

  const selected = new Set(
    cut.elementIds.filter((id) => byId.get(id)?.kind === "elements"),
  );
  // Traverse: context (non-element) items reachable from the selection
  // without passing through unselected elements.
  const context = new Set<string>();
  const queue = [...selected];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      const entry = byId.get(next);
      if (!entry) continue;
      if (entry.kind === "elements") continue; // never pull other elements
      context.add(next);
      queue.push(next);
    }
  }

  const isLive = (id: string): boolean => {
    const e = byId.get(id);
    return e !== undefined && e.item.checked && e.item.state === "active";
  };
  const shipIds = [...selected].filter(isLive);
  const flagIds = [...context].filter(isLive);
  const uncheckedElements = [...selected].filter(
    (id) => byId.get(id)?.item.state === "active" && !byId.get(id)!.item.checked,
  );

  const intentSource =
    cut.intent?.trim() ||
    model.curatedIntent?.trim() ||
    goalSection(model).text;
  const title = projectionTitle(model, intentSource);

  const included = new Set([...shipIds, ...flagIds]);
  const parts: string[] = [];
  if (intentSource.trim()) {
    parts.push("## Goal", intentSource.trim(), "");
  }
  const textById = new Map<string, string>();
  for (const { item } of byId.values()) textById.set(item.id, item.text);
  for (const s of model.sections) {
    const picked = s.items.filter((it) => included.has(it.id));
    if (picked.length === 0) continue;
    const header = KIND_TO_TEP_HEADER[s.kind];
    if (header && header !== "## Goal") parts.push(header);
    for (const it of picked) {
      const sup = it.supersedes
        ? ` (supersedes ${textById.get(it.supersedes) ?? it.supersedes})`
        : "";
      parts.push(`- ${it.text}${sup}${evalSuffix(it)}`);
    }
    parts.push("");
  }
  return {
    title,
    body: parts.join("\n").trim(),
    shipIds,
    flagIds,
    uncheckedElements,
    contextIds: [...context],
  };
}
