/**
 * The edge renderer: the one dependency-line primitive, drawn with the
 * shared arrow marker the Canvas defines.
 */
import { EDGE_COLOR } from "./Canvas";

export function Edge(props: {
  from: { x: number; y: number };
  to: { x: number; y: number };
}): JSX.Element {
  return (
    <line
      x1={props.from.x}
      y1={props.from.y}
      x2={props.to.x}
      y2={props.to.y}
      stroke={EDGE_COLOR}
      strokeWidth={1.5}
      markerEnd="url(#gc-arrow)"
      data-graph-edge
    />
  );
}
