/**
 * The node frame: the one rounded-rect body every graph node uses — accent
 * bar, optional dashed outline, and in-place label expansion. A truncated
 * label expands INTO THE CANVAS as body content on click (no tooltip-only
 * text); the parent owns expansion state so it survives re-layout.
 */
import { ReactNode } from "react";
import {
  expandableLabel,
  wrapBody,
} from "../../../../src/surfaces/graphCore/expander";

const LINE_H = 14;


export function NodeFrame(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  accent: string;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  title: string;
  /** Characters per line before the title truncates in compact state. */
  titleChars?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onClick?: () => void;
  hoverTitle?: string;
  children?: ReactNode;
}): JSX.Element {
  const chars = props.titleChars ?? 24;
  const label = expandableLabel({
    text: props.title,
    maxChars: chars,
    expanded: !!props.expanded,
  });
  const lines = label.expanded ? wrapBody(label.full, chars) : undefined;
  const bodyH = lines ? props.h + lines.length * LINE_H : props.h;
  return (
    <g
      transform={`translate(${props.x},${props.y})`}
      onClick={
        props.onClick
          ? (e) => {
              e.stopPropagation();
              props.onClick!();
            }
          : undefined
      }
      style={props.onClick ? { cursor: "pointer" } : undefined}
      data-node-frame
    >
      {props.hoverTitle ? <title>{props.hoverTitle}</title> : null}
      <rect
        width={props.w}
        height={bodyH}
        rx={8}
        fill="var(--vscode-editor-background)"
        stroke={props.stroke ?? props.accent}
        strokeWidth={props.strokeWidth ?? 2}
        strokeDasharray={props.dashed ? "5 3" : undefined}
      />
      <rect width={6} height={bodyH} rx={3} fill={props.accent} />
      {lines ? (
        <g data-expanded-label>
          {lines.map((l, i) => (
            <text
              key={i}
              x={16}
              y={20 + i * LINE_H}
              fill="var(--vscode-foreground)"
              fontSize={12}
              fontWeight={600}
            >
              {l}
            </text>
          ))}
        </g>
      ) : (
        <text
          x={16}
          y={20}
          fill="var(--vscode-foreground)"
          fontSize={12}
          fontWeight={600}
        >
          {label.body}
        </text>
      )}
      {label.expander && props.onToggleExpand ? (
        <text
          x={props.w - 44}
          y={20}
          fill="var(--vscode-descriptionForeground, #aaa)"
          fontSize={11}
          style={{ cursor: "pointer" }}
          data-expander
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleExpand!();
          }}
        >
          {label.expander.label}
        </text>
      ) : null}
      {props.children}
    </g>
  );
}
