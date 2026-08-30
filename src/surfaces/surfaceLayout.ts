/**
 * The top-to-bottom order of the space surface's regions, for every page.
 * One place names it, so the row of pages draws at the same position
 * everywhere and a page cannot quietly reorder around it.
 */

/** The surface's four pages. The only declaration of this union in the
 *  repository — every reader imports it, rather than writing its own. */
export type SurfacePage = "write" | "intent" | "work" | "flow";

/** The pages, in the order the tab row shows them. A runtime list, not
 *  just a type, so a test can drive `surfaceRegions` against every page
 *  the surface actually has. */
export const SURFACE_PAGES: readonly SurfacePage[] = ["write", "intent", "work", "flow"];

/** A drawn band of the surface, top to bottom. */
export type SurfaceRegion =
  | "asking-in"
  | "tabs"
  | "legacy"
  | "capture"
  | "asks"
  | "page";

/** The regions this page draws, top to bottom. "asking-in" then "tabs"
 *  come first for every page, at the same index, so the tab row's
 *  position never depends on which page is showing. What is below it
 *  is the page's own business. */
export function surfaceRegions(page: SurfacePage): SurfaceRegion[] {
  const below: SurfaceRegion[] =
    page === "write" ? ["capture", "page"] :
    page === "intent" ? ["asks", "page"] :
    page === "work" ? ["legacy", "page"] :
    ["legacy", "page"];
  return ["asking-in", "tabs", ...below];
}
