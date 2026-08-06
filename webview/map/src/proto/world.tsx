/**
 * The approved prototype's viewport, ported verbatim: a CSS-transformed
 * world (drag = pan, wheel = zoom to cursor, +/−/⤢ controls), with the
 * `far` level-of-detail class below the legibility floor — text never
 * shrinks below it; nodes simplify instead.
 */
import { useCallback, useRef, useState } from "react";

export interface World {
  tx: number;
  ty: number;
  k: number;
  far: boolean;
  onWheel: (e: React.WheelEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

const FAR_BELOW = 0.62;

export function useWorld(): World {
  const [t, setT] = useState({ tx: 30, ty: 30, k: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const f = e.deltaY < 0 ? 1.12 : 0.89;
    setT((cur) => {
      const nk = Math.min(2.5, Math.max(0.3, cur.k * f));
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      return {
        tx: cx - (cx - cur.tx) * (nk / cur.k),
        ty: cy - (cy - cur.ty) * (nk / cur.k),
        k: nk,
      };
    });
  }, []);

  return {
    ...t,
    far: t.k < FAR_BELOW,
    onWheel,
    onMouseDown: (e) => {
      drag.current = { x: e.clientX - t.tx, y: e.clientY - t.ty };
    },
    onMouseMove: (e) => {
      const d = drag.current;
      if (d) setT((cur) => ({ ...cur, tx: e.clientX - d.x, ty: e.clientY - d.y }));
    },
    onMouseUp: () => {
      drag.current = null;
    },
    zoomIn: () => setT((c) => ({ ...c, k: Math.min(2.5, c.k * 1.2) })),
    zoomOut: () => setT((c) => ({ ...c, k: Math.max(0.3, c.k / 1.2) })),
    fit: () => setT({ tx: 30, ty: 30, k: 1 }),
  };
}

export function ZoomControls(props: { world: World }): JSX.Element {
  const btn: React.CSSProperties = {
    width: 30,
    height: 30,
    background: "var(--card, #252526)",
    color: "inherit",
    border: "1px solid var(--border, #3c3c3c)",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 15,
  };
  return (
    <div data-zoom-controls style={{ position: "absolute", left: 10, bottom: 10, display: "flex", gap: 5, zIndex: 3 }}>
      <button style={btn} title="Zoom in" onClick={props.world.zoomIn}>+</button>
      <button style={btn} title="Zoom out" onClick={props.world.zoomOut}>−</button>
      <button style={btn} title="Fit" onClick={props.world.fit}>⤢</button>
    </div>
  );
}
