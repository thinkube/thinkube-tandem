/**
 * The approved prototype's viewport, ported faithfully: NATIVE listeners
 * (wheel is non-passive so preventDefault works; drag tracks on window so
 * it can never stick), live transform state read through a ref — never a
 * stale or recycled event. Drag = pan (left button, never from an
 * interactive element), wheel = zoom to cursor, +/−/⤢ controls, `far`
 * below the legibility floor.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface World {
  tx: number;
  ty: number;
  k: number;
  far: boolean;
  /** Put this on the canvas element — it wires wheel + drag natively. */
  ref: (el: HTMLElement | null) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

const FAR_BELOW = 0.62;
const K_MIN = 0.3;
const K_MAX = 2.5;

const INTERACTIVE = "button, input, textarea, select, a, [data-more]";

export function useWorld(): World {
  const [t, setT] = useState({ tx: 30, ty: 30, k: 1 });
  const live = useRef(t);
  live.current = t;
  const [el, setEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cur = live.current;
      const f = e.deltaY < 0 ? 1.12 : 0.89;
      const nk = Math.min(K_MAX, Math.max(K_MIN, cur.k * f));
      if (!Number.isFinite(nk) || nk === cur.k) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const next = {
        tx: cx - (cx - cur.tx) * (nk / cur.k),
        ty: cy - (cy - cur.ty) * (nk / cur.k),
        k: nk,
      };
      if (Number.isFinite(next.tx) && Number.isFinite(next.ty)) {
        live.current = next; // bursts accumulate — rapid wheel ticks never read stale state
        setT(next);
      }
    };
    let drag: { x: number; y: number } | null = null;
    const onDown = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
      drag = { x: e.clientX - live.current.tx, y: e.clientY - live.current.ty };
    };
    const onMove = (e: MouseEvent): void => {
      if (!drag) return;
      const next = { ...live.current, tx: e.clientX - drag.x, ty: e.clientY - drag.y };
      if (Number.isFinite(next.tx) && Number.isFinite(next.ty)) {
        live.current = next;
        setT(next);
      }
    };
    const onUp = (): void => {
      drag = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [el]);

  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  return {
    ...t,
    far: t.k < FAR_BELOW,
    ref,
    zoomIn: () => setT((c) => ({ ...c, k: Math.min(K_MAX, c.k * 1.2) })),
    zoomOut: () => setT((c) => ({ ...c, k: Math.max(K_MIN, c.k / 1.2) })),
    fit: () => setT({ tx: 30, ty: 30, k: 1 }),
  };
}

export function ZoomControls(props: { world: World }): JSX.Element {
  const btn: React.CSSProperties = {
    width: 30,
    height: 30,
    background: "var(--vscode-editorWidget-background, #252526)",
    color: "inherit",
    border: "1px solid var(--vscode-panel-border, #3c3c3c)",
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
