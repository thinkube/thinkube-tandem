/**
 * Semantic-zoom LOD: at low zoom a node switches to a compact representation
 * instead of letting text scale below the legibility floor. The invariant:
 * every text a representation emits satisfies size × zoom ≥ the floor at the
 * lowest zoom where that representation is active.
 */

export const LEGIBILITY_FLOOR_PX = 12;

/** The configured minimum zoom (the viewport clamp minimum). */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 2.5;

export type Representation = "far" | "mid" | "near";

/** far is active from ZOOM_MIN up to MID_THRESHOLD, mid up to NEAR_THRESHOLD. */
export const MID_THRESHOLD = LEGIBILITY_FLOOR_PX / 16; // 0.75 — mid's smallest font is 16px
export const NEAR_THRESHOLD = LEGIBILITY_FLOOR_PX / 10; // 1.2 — near's smallest font is 10px

export function representationFor(zoom: number): Representation {
  if (zoom < MID_THRESHOLD) return "far";
  if (zoom < NEAR_THRESHOLD) return "mid";
  return "near";
}

/**
 * Per-representation font table. far emits ONLY the title, sized to clear
 * the floor at ZOOM_MIN; mid emits title + badges; near the full card.
 */
export function fontSizesFor(rep: Representation): {
  title: number;
  badge?: number;
  body?: number;
} {
  switch (rep) {
    case "far":
      return { title: Math.ceil(LEGIBILITY_FLOOR_PX / ZOOM_MIN) }; // 30px
    case "mid":
      return { title: 18, badge: 16 };
    case "near":
      return { title: 13, badge: 10, body: 10 };
  }
}

/** The single shared rule for what a declared font size renders at. */
export function effectiveFontSize(declared: number, zoom: number): number {
  return declared * zoom;
}
