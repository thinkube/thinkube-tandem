/**
 * The canvas shell: the single zoomable SVG surface every graph view draws
 * on. Owns the arrow-marker defs, the transformed content group, and the
 * visible on-canvas zoom / fit controls (AC: wheel and controls both zoom).
 */
import { ReactNode } from "react";
import { Viewport } from "./useViewport";

export const EDGE_COLOR = "var(--vscode-editorIndentGuide-background, #888)";

export function Canvas(props: {
  viewport: Viewport;
  /** Content bounds for the fit-to-view control. */
  contentBounds: { x: number; y: number; w: number; h: number };
  children: ReactNode;
  /** Extra controls rendered beside zoom/fit (e.g. focus-island buttons). */
  extraControls?: ReactNode;
}): JSX.Element {
  const { viewport, contentBounds } = props;
  const { transform } = viewport;
  const btn: React.CSSProperties = {
    width: 28,
    height: 28,
    border: "1px solid var(--vscode-panel-border, #444)",
    background: "var(--vscode-editorWidget-background, #222)",
    color: "var(--vscode-foreground, #ddd)",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 14,
    lineHeight: "26px",
    padding: 0,
  };
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <svg
        ref={viewport.svgRef}
        width="100%"
        height="100%"
        style={{ display: "block", cursor: "grab" }}
        data-graph-canvas
      >
        <defs>
          <marker
            id="gc-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={EDGE_COLOR} />
          </marker>
        </defs>
        <g
          transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
        >
          {props.children}
        </g>
      </svg>
      <div
        style={{
          position: "absolute",
          right: 10,
          bottom: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <button title="Zoom in" style={btn} onClick={viewport.zoomIn} data-zoom-in>
          +
        </button>
        <button title="Zoom out" style={btn} onClick={viewport.zoomOut} data-zoom-out>
          −
        </button>
        <button
          title="Fit everything into view"
          style={btn}
          onClick={() => viewport.fit(contentBounds)}
          data-zoom-fit
        >
          ⛶
        </button>
        {props.extraControls}
      </div>
    </div>
  );
}
