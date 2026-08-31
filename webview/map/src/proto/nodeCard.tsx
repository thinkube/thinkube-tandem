/**
 * A unit card: bold wrapping title, the FULL abstract (always complete —
 * the human's ruling; text wraps, never truncates), chip badges, an
 * optional decision strip. A card in the cut wears gold all over.
 *
 * A card's live state is a second, independent mark: a coloured frame and
 * a short state word, both of which survive the far zoom where chips are
 * dropped. The in-cut gold is a different fact from the state frame — a
 * card can be both in the cut and running — so the two marks never share a
 * colour or a word.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { C, FS, SP } from "../type";

export const NODE_W = 230;

export interface Chip {
  text: string;
  kind?: "el" | "con" | "ac" | "q" | "stale" | "cut" | "na" | "run" | "pass" | "plain";
  /** Plain-English hover explanation of why this chip is on the card. */
  why?: string;
}

export interface CardData {
  id: string;
  title: string;
  /** The whole sentence behind a clipped title — shown on hover. */
  titleFull?: string;
  abs?: string;
  chips: Chip[];
  decision?: string;
  /** In the cut: the whole card wears gold — and says so, because a
   *  colour on its own is not a word. */
  inCut?: boolean;
  /** What this card IS, in a word: the band across its top. */
  band?: { text: string; color: string; why?: string };
  /** This card's live state: a tone for its frame and a word that
   *  survives the far zoom, from stateFace(). A different mark from
   *  inCut's gold — a card can carry both at once. */
  face?: { word: string; tone: "run" | "q" | "pass" | "na" | "idle" | "block"; why: string };
}

const FACE_COLORS: Record<NonNullable<CardData["face"]>["tone"], string> = {
  run: C.live,
  q: C.ask,
  pass: C.ok,
  na: C.bad,
  block: "#9d5fd6",
  idle: C.quiet,
};

const CHIP_COLORS: Record<NonNullable<Chip["kind"]>, { border: string; color: string; bg?: string }> = {
  el: { border: C.ok, color: C.ok, bg: "#4ec9b01a" },
  con: { border: C.ask, color: C.ask, bg: "#ee9b4e1a" },
  ac: { border: C.ok, color: C.ok, bg: "#89d1851a" },
  q: { border: C.ask, color: C.ask, bg: "#e5c07b26" },
  stale: { border: C.gold, color: C.gold },
  cut: { border: C.live, color: C.live },
  na: { border: C.bad, color: C.bad },
  run: { border: C.live, color: C.live },
  pass: { border: C.ok, color: C.ok },
  plain: { border: C.border, color: "inherit" },
};

function ChipEl(props: { chip: Chip }): JSX.Element {
  const c = CHIP_COLORS[props.chip.kind ?? "plain"];
  return (
    <span
      title={props.chip.why}
      style={{
        fontSize: FS.caption,
        padding: `${SP.xs}px ${SP.sm}px`,
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
  const faceColor = card.face ? FACE_COLORS[card.face.tone] : undefined;
  // The in-cut gold is a fact about membership; the face tone is a fact
  // about live state. Gold stays the border; the face rides as a ring
  // outside it, so both survive together and neither reads as the other.
  const rings = [
    props.selected ? "0 0 0 3px #3794ff44" : undefined,
    faceColor ? `0 0 0 ${card.inCut ? 5 : 2}px ${faceColor}55` : undefined,
    card.inCut && !props.selected ? "0 0 0 1px #cca70055" : undefined,
    "0 2px 6px #0006",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div
      data-node={card.id}
      onClick={() => props.onClick?.(card.id)}
      style={{
        position: "absolute",
        width: NODE_W,
        background: card.inCut ? "#cca70014" : C.raised,
        border: card.inCut
          ? "2px solid var(--gold, #cca700)"
          : `1px solid ${faceColor ?? (props.selected ? C.focus : C.border)}`,
        borderRadius: 6,
        padding: `${SP.sm}px ${SP.md}px`,
        boxShadow: rings,
        boxSizing: "border-box",
        transition: "left .35s, top .35s",
        cursor: props.onClick ? "pointer" : undefined,
        ...props.style,
      }}
    >
      {far && (card.face || card.inCut) ? (
        <div
          data-face
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 4,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {card.face ? (
            <span title={card.face.why} style={{ color: faceColor }}>
              {card.face.word}
            </span>
          ) : null}
          {card.inCut ? (
            <span title="Part of the signed work being built now." style={{ color: "var(--gold, #cca700)" }}>
              cut
            </span>
          ) : null}
        </div>
      ) : null}
      {card.band ? (
        <div
          data-band={card.band.text}
          title={card.band.why}
          style={{
            margin: "-8px -10px 6px",
            padding: `${SP.xs}px ${SP.md}px`,
            borderRadius: "5px 5px 0 0",
            borderBottom: `1px solid ${card.band.color}`,
            background: `${card.band.color}1f`,
            color: card.band.color,
            fontSize: far ? 13 : 11,
            fontWeight: 600,
          }}
        >
          {card.band.text}
        </div>
      ) : null}
      <h3
        title={card.titleFull ?? undefined}
        style={{ margin: "0 0 4px", fontSize: far ? 15 : 13, fontWeight: 600, overflowWrap: "anywhere" }}
      >
        {card.title}
      </h3>
      {!far && card.abs ? (
        <div style={{ color: C.quiet, fontSize: FS.body, overflowWrap: "anywhere", whiteSpace: "pre-line" }}>
          {card.abs}
        </div>
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
            padding: `${SP.xs}px ${SP.sm}px`,
            fontSize: FS.body,
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
