/**
 * refResolver — ONE grammar for spec/slice references, used by every kanban tool.
 *
 * Why this exists (2026-07-11, TEP-1_SP-4 post-mortem): the server historically
 * spoke three id vocabularies — the composite `1/4` (what the org tree is keyed
 * by), the flat spec handle `TEP-1_SP-4` (what `specHandle()` PRINTS in every
 * board surface), and the slice handle `TEP-1_SP-4_SL-1` — and each tool accepted
 * a different subset. Worse, an unrecognized form was passed through verbatim, so
 * `pathForSpecDoc("TEP-1_SP-4")` silently built `teps/TEP-TEP-1_SP-4/SP-undefined/…`
 * instead of erroring. This module is the single parser: every accepted written
 * form normalizes to the composite id, and anything else throws an error that
 * STATES the grammar. No caller may ever again feed a raw ref to a path builder.
 *
 * Accepted spec forms (all normalize to the composite `<tep>/<sp>`):
 *   `1/4` · `TEP-1/SP-4` · `TEP-1/4` · `SP-1/4` · `TEP-1_SP-4` · `SP-4` · `4`
 * The two bare forms (`SP-4`, `4`) are resolved against the thinking space's spec
 * dirs: a unique match wins, an ambiguous one refuses naming the candidate TEPs,
 * and an unknown one REFUSES (it used to pass through verbatim — that is exactly
 * the silent `SP-undefined` path bug).
 *
 * Accepted slice forms:
 *   `TEP-1_SP-4_SL-1` · `SP-4_SL-1` (spec part resolved like a bare spec ref) ·
 *   `1/4/1`
 *
 * All segments are strictly numeric — ids are minted sequentially, and the
 * per-maintainer org segment is what keeps numbers collision-free. Any other
 * id shape fails loudly; nothing is quietly tolerated.
 */

const ID = "\\d+";

/** `1/4` · `TEP-1/SP-4` · `TEP-1/4` · `SP-1/4` (attend's Spec-id form). */
const COMPOSITE_RE = new RegExp(`^(?:TEP-|SP-)?(${ID})/(?:SP-)?(${ID})$`);
/** `TEP-1_SP-4` — the flat spec handle every board surface prints. */
const FLAT_SPEC_RE = new RegExp(`^TEP-(${ID})_SP-(${ID})$`);
/** `SP-4` · `4` — bare SP id, needs a lookup (SP numbers are per-TEP). */
const BARE_SPEC_RE = new RegExp(`^(?:SP-)?(${ID})$`);

/** `TEP-1_SP-4_SL-1` — the full slice handle. */
const FULL_SLICE_RE = new RegExp(`^TEP-(${ID})_SP-(${ID})_SL-(\\d+)$`);
/** `SP-4_SL-1` — TEP-less slice handle (spec part resolved by lookup). */
const SHORT_SLICE_RE = new RegExp(`^SP-(${ID})_SL-(\\d+)$`);
/** `1/4/1` — fully composite slice ref. */
const COMPOSITE_SLICE_RE = new RegExp(`^(${ID})/(${ID})/(\\d+)$`);

export const SPEC_REF_GRAMMAR =
  "a spec ref: `<tep>/<sp>` (e.g. `1/4`), `TEP-1/SP-4`, `SP-1/4`, `TEP-1_SP-4`, or a bare `SP-4`/`4` (resolved against the thinking space's TEPs)";
export const SLICE_REF_GRAMMAR =
  "a slice ref: `TEP-1_SP-4_SL-1`, `SP-4_SL-1`, or `1/4/1`";

export type NormalizedSpecRef =
  | { kind: "composite"; id: string }
  | { kind: "bare"; id: string };

/**
 * Purely lexical normalization — no lookup. A two-part form yields its
 * composite; a one-part form yields the bare SP id (the caller decides whether
 * to look it up or compose it with a known parent TEP, as `write_spec` does
 * for a spec that does not exist yet). Anything else throws, stating the grammar.
 */
export function normalizeSpecRef(input: string): NormalizedSpecRef {
  const ref = input.trim();
  const composite = COMPOSITE_RE.exec(ref) ?? FLAT_SPEC_RE.exec(ref);
  if (composite) {
    return { kind: "composite", id: `${composite[1]}/${composite[2]}` };
  }
  const bare = BARE_SPEC_RE.exec(ref);
  if (bare) return { kind: "bare", id: bare[1] };
  throw new Error(`Unrecognized spec id "${input}" — expected ${SPEC_REF_GRAMMAR}.`);
}

/**
 * Full resolution to the composite `<tep>/<sp>` id the org tree is keyed by.
 * Composite forms pass through without a lookup (composite ids are
 * authoritative; a miss is reported by the caller against the true path).
 * Bare forms resolve against `listSpecDirs()`: unique → composite; ambiguous →
 * refused naming the candidate TEPs; unknown → REFUSED (never returned
 * verbatim — a verbatim bare id downstream becomes `TEP-<id>/SP-undefined`).
 */
export async function resolveSpecRef(
  listSpecDirs: () => Promise<string[]>,
  input: string,
): Promise<string> {
  const ref = normalizeSpecRef(input);
  if (ref.kind === "composite") return ref.id;
  const dirs = await listSpecDirs();
  const matches = dirs.filter((s) => s.split("/")[1] === ref.id);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous spec id "${input}" — SP-${ref.id} exists under ${matches
        .map((m) => "TEP-" + m.split("/")[0])
        .join(", ")}. Pass the composite \`<tep>/${ref.id}\` (e.g. \`${matches[0]}\`).`,
    );
  }
  throw new Error(
    `No spec SP-${ref.id} found in this thinking space (searched ${new Set(
      dirs.map((d) => d.split("/")[0]),
    ).size} TEP(s)). Pass ${SPEC_REF_GRAMMAR}.`,
  );
}

/**
 * Resolve a slice ref to its (composite spec id, slice number). The TEP-less
 * `SP-4_SL-1` form resolves its spec part exactly like a bare spec ref.
 */
export async function resolveSliceRef(
  listSpecDirs: () => Promise<string[]>,
  input: string,
): Promise<{ specNumber: string; sliceNumber: number }> {
  const ref = input.trim();
  const full = FULL_SLICE_RE.exec(ref) ?? COMPOSITE_SLICE_RE.exec(ref);
  if (full) {
    return { specNumber: `${full[1]}/${full[2]}`, sliceNumber: Number(full[3]) };
  }
  const short = SHORT_SLICE_RE.exec(ref);
  if (short) {
    const specNumber = await resolveSpecRef(listSpecDirs, short[1]);
    return { specNumber, sliceNumber: Number(short[2]) };
  }
  throw new Error(
    `Unrecognized slice handle "${input}" — expected ${SLICE_REF_GRAMMAR}.`,
  );
}
