/**
 * spaceManifest — the thinking space's card (`space.yaml`), TEP-14.
 *
 * The card is CONFIGURATION, never a name. A space's name is written exactly
 * one way everywhere — the workspace spelling (`Platform/core/thinkube-control`)
 * — and the card, sitting inside the space directory, declares the
 * maintainers and marks the directory as a thinking space:
 *
 *   orgs: [cmxela]
 *
 * `orgs` is the declared maintainer list — TEP/SP numbering is scoped per
 * (space, org); admitting a maintainer is one reviewable line here, and a
 * maintainer subtree on disk that is not declared refuses loudly. The
 * cross-maintainer reference grammar is deliberately a future TEP.
 *
 * The working REPOSITORY needs no declaration: the filesystem copy at the
 * space's workspace path IS the repository — tools verify the resolved
 * directory exists and is a git repository, nothing more. (A git-remote
 * field was considered and rejected: it gates nothing the copy doesn't
 * already prove, and it would false-alarm on every repository rename.)
 *
 * Pure (string level); reading/walking lives in `spaceRegistry.ts`.
 */
import { parse as yamlParse } from "yaml";

/** The card filename — also the marker that a directory is a thinking space. */
export const SPACE_CARD_FILENAME = "space.yaml";

export interface SpaceCard {
  /** Declared maintainer segments (numbering scope per org). May be empty. */
  orgs: string[];
}

/** One path segment: letters, digits, dot, dash, underscore. */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Parse + validate one card. `source` names the file in every error so a
 * refusal points at the offending card, never at a stack trace. Unknown keys
 * refuse — a card carries exactly what the schema declares.
 */
export function parseSpaceCard(yamlText: string, source: string): SpaceCard {
  const fail = (msg: string): never => {
    throw new Error(`${source}: ${msg}`);
  };
  let raw: unknown;
  try {
    raw = yamlParse(yamlText);
  } catch (err) {
    return fail(`not valid YAML — ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return fail("the card must be a YAML mapping");
  const m = raw as Record<string, unknown>;

  const unknown = Object.keys(m).filter((k) => k !== "orgs");
  if (unknown.length)
    return fail(`unknown key(s): ${unknown.join(", ")} — a card declares only \`orgs\``);

  const orgsRaw = m.orgs;
  if (!Array.isArray(orgsRaw) || orgsRaw.some((o) => typeof o !== "string"))
    return fail("`orgs` must be a list of maintainer segments (may be empty)");
  const orgs = (orgsRaw as string[]).map((o) => o.trim());
  if (orgs.some((o) => !SEGMENT.test(o)))
    return fail("`orgs` entries must be single path segments");
  if (new Set(orgs).size !== orgs.length)
    return fail("`orgs` entries must be unique");

  return { orgs };
}
