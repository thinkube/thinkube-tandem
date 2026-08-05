/**
 * Semantic-zoom LOD (SP-10 AC): at the configured minimum zoom every node is
 * compact and no rendered text's effective font size falls below the floor —
 * asserted over the produced SVG markup of the render function at minZoom.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LEGIBILITY_FLOOR_PX,
  MID_THRESHOLD,
  NEAR_THRESHOLD,
  ZOOM_MIN,
  effectiveFontSize,
  fontSizesFor,
  representationFor,
} from "./lod";
import { renderUnitsMapSvg, unitsNodeSpec, UnitCardData } from "./unitsNode";

const CARDS: UnitCardData[] = [
  { id: "unit-1", title: "A unit with a reasonably long title", count: 3, inCut: true },
  { id: "unit-2", title: "Second", count: 1 },
];

const POS = new Map(CARDS.map((c, i) => [c.id, { x: i * 300, y: 0 }]));

test("every representation clears the floor at the lowest zoom where it is active", () => {
  const lowest: Record<string, number> = {
    far: ZOOM_MIN,
    mid: MID_THRESHOLD,
    near: NEAR_THRESHOLD,
  };
  for (const rep of ["far", "mid", "near"] as const) {
    const fonts = fontSizesFor(rep);
    for (const size of Object.values(fonts))
      assert.ok(
        effectiveFontSize(size!, lowest[rep]) >= LEGIBILITY_FLOOR_PX,
        `${rep} font ${size} at zoom ${lowest[rep]}`,
      );
  }
});

test("at minZoom the rendered markup is compact and every text clears the floor (AC #1)", () => {
  const rep = representationFor(ZOOM_MIN);
  assert.equal(rep, "far", "minZoom renders the compact representation");
  const svg = renderUnitsMapSvg(CARDS, POS, ZOOM_MIN, rep);

  const zoom = Number(svg.match(/data-zoom="([\d.]+)"/)![1]);
  assert.equal(zoom, ZOOM_MIN);
  const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length >= CARDS.length, "every node emits its title text");
  for (const s of sizes)
    assert.ok(
      effectiveFontSize(s, zoom) >= LEGIBILITY_FLOOR_PX,
      `declared ${s}px at zoom ${zoom} ⇒ ${s * zoom}px effective`,
    );
  assert.ok(!/data-role="badge"|data-role="body"/.test(svg), "far emits titles only");
});

test("representation switches at the thresholds; near emits the full card", () => {
  assert.equal(representationFor(MID_THRESHOLD), "mid");
  assert.equal(representationFor(NEAR_THRESHOLD), "near");
  const nearTexts = unitsNodeSpec(CARDS[0], "near");
  assert.ok(nearTexts.some((t) => t.role === "badge"));
  assert.ok(nearTexts.some((t) => t.role === "body"));
  const farTexts = unitsNodeSpec(CARDS[0], "far");
  assert.deepEqual(farTexts.map((t) => t.role), ["title"]);
});
