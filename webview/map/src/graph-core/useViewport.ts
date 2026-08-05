/**
 * The zoomable viewport: d3-zoom drives wheel + drag gestures, and every
 * transform — gesture or control — passes through the shared pure math in
 * host graphCore/viewport.ts, so the clamps hold on every path.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, ZoomBehavior } from "d3-zoom";
import {
  Clamps,
  Transform,
  fitView,
  focus,
  zoomBy,
} from "../../../../src/surfaces/graphCore/viewport";

export interface Viewport {
  transform: Transform;
  svgRef: React.RefObject<SVGSVGElement>;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: (content: { x: number; y: number; w: number; h: number }) => void;
  focusOn: (bounds: { x: number; y: number; w: number; h: number }, k?: number) => void;
  clamps: Clamps;
}

const DEFAULT_CLAMPS: Clamps = { min: 0.25, max: 2.5 };

export function useViewport(clamps: Clamps = DEFAULT_CLAMPS): Viewport {
  const svgRef = useRef<SVGSVGElement>(null);
  const behaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([clamps.min, clamps.max])
      .on("zoom", (ev) => {
        const t = ev.transform as { x: number; y: number; k: number };
        setTransform({ x: t.x, y: t.y, k: t.k });
      });
    behaviorRef.current = behavior;
    select(svg).call(behavior);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, [clamps.min, clamps.max]);

  return useMemo(() => {
    const apply = (t: Transform) => {
      const svg = svgRef.current;
      const behavior = behaviorRef.current;
      if (svg && behavior)
        select(svg).call(
          behavior.transform,
          zoomIdentity.translate(t.x, t.y).scale(t.k),
        );
      else setTransform(t);
    };
    const size = () => {
      const svg = svgRef.current;
      return svg
        ? { w: svg.clientWidth || 800, h: svg.clientHeight || 600 }
        : { w: 800, h: 600 };
    };
    return {
      transform,
      svgRef,
      zoomIn: () => {
        const v = size();
        apply(zoomBy(transform, 1.4, clamps, { x: v.w / 2, y: v.h / 2 }));
      },
      zoomOut: () => {
        const v = size();
        apply(zoomBy(transform, 1 / 1.4, clamps, { x: v.w / 2, y: v.h / 2 }));
      },
      fit: (content) => apply(fitView(content, size(), clamps)),
      focusOn: (bounds, k) => apply(focus(bounds, size(), clamps, k ?? transform.k)),
      clamps,
    };
  }, [transform, clamps]);
}
