/**
 * The badge: the one pill-shaped counter/label primitive used on graph
 * nodes (coverage fractions, open-question counts, status words).
 */
export function Badge(props: {
  x: number;
  y: number;
  text: string;
  color: string;
  title?: string;
  testId?: string;
}): JSX.Element {
  const w = props.text.length * 6.4 + 12;
  return (
    <g transform={`translate(${props.x},${props.y})`} data-badge={props.testId}>
      {props.title ? <title>{props.title}</title> : null}
      <rect
        width={w}
        height={16}
        rx={8}
        fill="transparent"
        stroke={props.color}
        strokeWidth={1}
      />
      <text x={6} y={12} fill={props.color} fontSize={10} fontWeight={600}>
        {props.text}
      </text>
    </g>
  );
}
