/** Viewport math: clamps hold on every path; fit encloses; focus centers (AC #1, #2 seams). */
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyWheel, clampScale, fitView, focus, zoomBy } from "./viewport";

const C = { min: 0.25, max: 3 };

test("clampScale bounds every scale; zoomBy and applyWheel never escape the clamps", () => {
  assert.equal(clampScale(0.01, C), 0.25);
  assert.equal(clampScale(99, C), 3);
  assert.equal(clampScale(1, C), 1);

  let t = { x: 0, y: 0, k: 1 };
  for (let i = 0; i < 50; i++) t = zoomBy(t, 2, C);
  assert.equal(t.k, C.max, "zooming in stops at max");
  for (let i = 0; i < 50; i++) t = applyWheel(t, +500, C, { x: 100, y: 80 });
  assert.equal(t.k, C.min, "wheel-out stops at min");
  assert.ok(applyWheel({ x: 0, y: 0, k: 1 }, -100, C, { x: 0, y: 0 }).k > 1, "wheel up zooms in");
});

test("zoomBy keeps the world point under the given center fixed", () => {
  const t = { x: 10, y: 20, k: 1 };
  const center = { x: 110, y: 120 };
  const world = { x: (center.x - t.x) / t.k, y: (center.y - t.y) / t.k };
  const t2 = zoomBy(t, 2, C, center);
  assert.equal(t2.x + world.x * t2.k, center.x);
  assert.equal(t2.y + world.y * t2.k, center.y);
});

test("fitView brings all content inside the viewport without violating clamps", () => {
  const content = { x: -50, y: 100, w: 400, h: 200 };
  const viewport = { w: 800, h: 600 };
  const t = fitView(content, viewport, C);
  assert.ok(t.k >= C.min && t.k <= C.max);
  const left = content.x * t.k + t.x;
  const top = content.y * t.k + t.y;
  const right = (content.x + content.w) * t.k + t.x;
  const bottom = (content.y + content.h) * t.k + t.y;
  assert.ok(left >= 0 && top >= 0 && right <= viewport.w && bottom <= viewport.h, "all nodes visible");

  const huge = fitView({ x: 0, y: 0, w: 100000, h: 100 }, viewport, C);
  assert.equal(huge.k, C.min, "fit never zooms below the min clamp");
});

test("focus centers the bounds in the viewport at a clamped scale", () => {
  const bounds = { x: 300, y: 500, w: 100, h: 60 };
  const viewport = { w: 800, h: 600 };
  const t = focus(bounds, viewport, C, 2);
  assert.equal((bounds.x + bounds.w / 2) * t.k + t.x, viewport.w / 2);
  assert.equal((bounds.y + bounds.h / 2) * t.k + t.y, viewport.h / 2);
  assert.equal(focus(bounds, viewport, C, 99).k, C.max, "focus scale is clamped");
});
