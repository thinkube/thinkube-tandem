/**
 * Viewport math for the zoomable canvas: pure transforms shared by the
 * wheel gesture, the on-canvas controls, fit-to-view and focus. Every
 * scale passes through the clamps; no path can escape them.
 */

export interface Clamps {
  min: number;
  max: number;
}

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export function clampScale(k: number, c: Clamps): number {
  return Math.min(Math.max(k, c.min), c.max);
}

/**
 * Scale by `factor`, keeping the world point under `center` fixed when a
 * center is given (the cursor for wheel zoom, the canvas middle for the
 * on-canvas controls). Without a center the translation is kept.
 */
export function zoomBy(
  t: Transform,
  factor: number,
  c: Clamps,
  center?: { x: number; y: number },
): Transform {
  const k = clampScale(t.k * factor, c);
  if (!center || k === t.k) return { ...t, k };
  const wx = (center.x - t.x) / t.k;
  const wy = (center.y - t.y) / t.k;
  return { x: center.x - wx * k, y: center.y - wy * k, k };
}

/** The wheel gesture: d3-zoom's default delta→factor mapping. */
export function applyWheel(
  t: Transform,
  deltaY: number,
  c: Clamps,
  center: { x: number; y: number },
): Transform {
  return zoomBy(t, Math.pow(2, -deltaY * 0.002), c, center);
}

/**
 * Fit all content into the viewport with padding, never violating the
 * clamps. When the clamped scale cannot show everything, the content is
 * centered at the closest allowed scale.
 */
export function fitView(
  content: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
  c: Clamps,
  pad = 24,
): Transform {
  const w = Math.max(content.w, 1);
  const h = Math.max(content.h, 1);
  const k = clampScale(
    Math.min((viewport.w - 2 * pad) / w, (viewport.h - 2 * pad) / h),
    c,
  );
  return {
    x: (viewport.w - w * k) / 2 - content.x * k,
    y: (viewport.h - h * k) / 2 - content.y * k,
    k,
  };
}

/** Center a node's or island's bounds in the viewport at scale `k` (clamped). */
export function focus(
  bounds: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
  c: Clamps,
  k?: number,
): Transform {
  const k2 = clampScale(k ?? 1, c);
  return {
    x: viewport.w / 2 - (bounds.x + bounds.w / 2) * k2,
    y: viewport.h / 2 - (bounds.y + bounds.h / 2) * k2,
    k: k2,
  };
}
