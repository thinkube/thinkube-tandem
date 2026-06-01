/**
 * Discrete semantic palette.
 *
 * Per the chunk-5 design conversation: every task wears a color, but the user
 * doesn't pick it from a free HSL picker — colors carry meaning. The current
 * scheme is "tasks under the same Epic share a color"; the mapping from epic
 * → palette slot is deterministic (modular hash), so reloads stay stable.
 *
 * Each entry has a `bg` (used for the card surface) and `accent` (used for
 * the left border and hover state). Colors are tuned to read against VS
 * Code's `--vscode-editor-background` in both light and dark themes — they
 * blend with VS Code's chrome rather than imposing their own brand.
 *
 * Chunk-7 hookup: the GitHubProjectsAdapter passes each task's `epicNumber`,
 * and the renderer calls `paletteForEpic(epicNumber)` to look up the slug.
 * Tasks with no epic (orphans, or pre-methodology cards) get the `neutral`
 * slug as a deliberate signal.
 */

export interface PaletteEntry {
  slug: string;
  label: string;
  bg: string;
  accent: string;
}

export const PALETTE: ReadonlyArray<PaletteEntry> = [
  { slug: "neutral", label: "Unassigned", bg: "#3a3a3a22", accent: "#888888" },
  { slug: "crimson", label: "Crimson", bg: "#e54d4d22", accent: "#e54d4d" },
  { slug: "amber", label: "Amber", bg: "#e0a02022", accent: "#e0a020" },
  { slug: "lime", label: "Lime", bg: "#7cc44022", accent: "#7cc440" },
  { slug: "teal", label: "Teal", bg: "#28b0a322", accent: "#28b0a3" },
  { slug: "azure", label: "Azure", bg: "#3a8fd622", accent: "#3a8fd6" },
  { slug: "indigo", label: "Indigo", bg: "#6a5acd22", accent: "#6a5acd" },
  { slug: "violet", label: "Violet", bg: "#a45fcf22", accent: "#a45fcf" },
  { slug: "magenta", label: "Magenta", bg: "#d44e9022", accent: "#d44e90" },
  { slug: "slate", label: "Slate", bg: "#5a7390aa", accent: "#5a7390" },
];

export const NEUTRAL_SLUG = "neutral";

const ASSIGNABLE = PALETTE.filter((p) => p.slug !== NEUTRAL_SLUG);

/**
 * Deterministically pick a palette slug for a given epic number. Same number
 * always maps to the same slug across sessions, machines, and reloads — the
 * hash is just `n mod assignableCount`.
 */
export function paletteForEpic(epicNumber: number | undefined): string {
  if (epicNumber == null || !Number.isFinite(epicNumber) || epicNumber <= 0) {
    return NEUTRAL_SLUG;
  }
  const idx = Math.floor(epicNumber) % ASSIGNABLE.length;
  return ASSIGNABLE[idx].slug;
}

export function lookupPalette(slug: string | undefined): PaletteEntry {
  if (!slug) return PALETTE[0];
  return PALETTE.find((p) => p.slug === slug) ?? PALETTE[0];
}
