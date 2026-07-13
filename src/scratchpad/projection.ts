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
