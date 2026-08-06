/**
 * The approved prototype's node, ported: an HTML card — bold wrapping
 * title, a two-line clamped abstract with `more…` growing the node (ELK
 * reflows the neighbors), chip badges in the kind palette, an optional
 * decision strip. Overflow is impossible by construction: text wraps and
 * clamps; it never leaves the card.
 */
import { useLayoutEffect, useRef, useState } from "react";

export const NODE_W = 230;

export interface Chip {
  text: string;
  kind?: "el" | "con" | "ac" | "q" | "stale" | "cut" | "na" | "run" | "pass" | "plain";
}

export interface CardData {
  id: string;
  title: string;
  abs?: string;
  chips: Chip[];
  decision?: string;
}

const CHIP_COLORS: Record<NonNullable<Chip["kind"]>, { border: string; color: string; bg?: string }> = {
  el: { border: "#4ec9b0", color: "#4ec9b0", bg: "#4ec9b01a" },
  con: { border: "#ee9b4e", color: "#ee9b4e", bg: "#ee9b4e1a" },
  ac: { border: "#89d185", color: "#89d185", bg: "#89d1851a" },
  q: { border: "#e5c07b", color: "#e5c07b", bg: "#e5c07b26" },
  stale: { border: "var(--warn, #cca700)", color: "var(--warn, #cca700)" },
  cut: { border: "var(--info, #3794ff)", color: "var(--info, #3794ff)" },
  na: { border: "var(--err, #f14c4c)", color: "var(--err, #f14c4c)" },
  run: { border: "var(--info, #3794ff)", color: "var(--info, #3794ff)" },
  pass: { border: "var(--ok, #4ec9b0)", color: "var(--ok, #4ec9b0)" },
  plain: { border: "var(--border, #3c3c3c)", color: "inherit" },
};

function ChipEl(props: { chip: Chip }): JSX.Element {
  const c = CHIP_COLORS[props.chip.kind ?? "plain"];
  return (
    <span
      style={{
        fontSize: 11,
        padding: "1px 7px",
        borderRadius: 8,
        border: `1px solid ${c.border}`,
        color: c.color,
        background: c.bg,
        fontWeight: props.chip.kind === "q" ? 600 : undefined,
        animation: props.chip.kind === "run" ? "tandemPulse 1.2s infinite" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {props.chip.text}
    </span>
  );
}

/**
 * Whether the body would be cut by the two-line clamp — only then is there
 * anything for `more…` to reveal. Line count is exact for the newline-
 * structured body; the length bound catches a long single line that wraps.
 */
function overflowsClamp(abs: string): boolean {
  return abs.split("\n").length > 2 || abs.length > 90;
}

export function NodeCard(props: {
  card: CardData;
  far: boolean;
  expanded: boolean;
  onToggle?: (id: string) => void;
  selected?: boolean;
  onClick?: (id: string) => void;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}): JSX.Element {
  const { card, far, expanded } = props;
  return (
    <div
      data-node={card.id}
      onClick={() => props.onClick?.(card.id)}
      style={{
        position: "absolute",
        width: NODE_W,
        background: "var(--vscode-editorWidget-background, #252526)",
        border: `1px solid ${props.selected ? "var(--vscode-focusBorder, #3794ff)" : "var(--vscode-panel-border, #3c3c3c)"}`,
        borderRadius: 6,
        padding: "8px 10px",
        boxShadow: "0 2px 6px #0006",
        boxSizing: "border-box",
        transition: "left .35s, top .35s",
        cursor: props.onClick ? "pointer" : undefined,
        ...props.style,
      }}
    >
      <h3 style={{ margin: "0 0 4px", fontSize: far ? 15 : 13, fontWeight: 600, overflowWrap: "anywhere" }}>
        {card.title}
      </h3>
      {!far && card.abs ? (
        <>
          <div
            style={
              expanded
                ? { color: "var(--vscode-descriptionForeground, #9d9d9d)", fontSize: 12, overflowWrap: "anywhere", whiteSpace: "pre-line" }
                : {
                    color: "var(--vscode-descriptionForeground, #9d9d9d)",
                    fontSize: 12,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-line",
                  }
            }
          >
            {card.abs}
          </div>
          {overflowsClamp(card.abs) ? (
            <span
              data-more={card.id}
              style={{ color: "var(--vscode-textLink-foreground, #3794ff)", cursor: "pointer", fontSize: 12, userSelect: "none" }}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggle?.(card.id);
              }}
            >
              {expanded ? "less" : "more…"}
            </span>
          ) : null}
        </>
      ) : null}
      {!far && card.chips.length ? (
        <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
          {card.chips.map((c, i) => (
            <ChipEl key={i} chip={c} />
          ))}
        </div>
      ) : null}
      {!far && card.decision ? (
        <div
          style={{
            marginTop: 6,
            borderLeft: "3px solid var(--ok, #4ec9b0)",
            padding: "3px 6px",
            fontSize: 12,
            background: "#4ec9b01a",
            overflowWrap: "anywhere",
          }}
        >
          {card.decision}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

/**
 * The prototype's `measure()`: render the cards hidden, read their real
 * heights, feed those to ELK. Re-measures when the cards or the expansion
 * set change — `more…` grows the node and ELK reflows the neighbors.
 */
export function useMeasuredHeights(
  cards: CardData[],
  expandedKey: string,
  far: boolean,
): { heights: Map<string, number>; probe: JSX.Element } {
  const ref = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = new Map<string, number>();
    for (const child of Array.from(el.children)) {
      const id = (child as HTMLElement).dataset.node;
      if (id) next.set(id, Math.ceil((child as HTMLElement).getBoundingClientRect().height));
    }
    setHeights((cur) => {
      if (cur.size === next.size && [...next].every(([k, v]) => cur.get(k) === v)) return cur;
      return next;
    });
  }, [cards, expandedKey, far]);
  const probe = (
    <div ref={ref} style={{ position: "absolute", visibility: "hidden", pointerEvents: "none" }} aria-hidden>
      {cards.map((c) => (
        <NodeCard
          key={c.id}
          card={c}
          far={far}
          expanded={expandedKey.split(",").includes(c.id)}
          style={{ position: "relative" }}
        />
      ))}
    </div>
  );
  return { heights, probe };
}
