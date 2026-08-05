/**
 * The unit card, as data: which texts a card shows at a given zoom
 * representation, each with its declared font size from the LOD table. The
 * React surface maps this spec verbatim to SVG, and the LOD test asserts
 * over its rendered markup — one source, no divergence.
 */
import { Representation, fontSizesFor } from "./lod";

export const UNIT_NODE_W = 240;
export const UNIT_NODE_H = 84;

export interface UnitCardData {
  id: string;
  title: string;
  /** How many changes the unit holds. */
  count: number;
  inCut?: boolean;
}

export interface NodeTextSpec {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  weight?: number;
  color: string;
  role: "title" | "badge" | "body";
}

export function unitsNodeSpec(
  card: UnitCardData,
  rep: Representation,
): NodeTextSpec[] {
  const fonts = fontSizesFor(rep);
  const fg = "var(--vscode-foreground, #ddd)";
  const dim = "var(--vscode-descriptionForeground, #aaa)";
  const texts: NodeTextSpec[] = [
    {
      text: card.title,
      x: 14,
      y: rep === "far" ? UNIT_NODE_H / 2 + fonts.title / 3 : 22,
      fontSize: fonts.title,
      weight: 600,
      color: fg,
      role: "title",
    },
  ];
  if (fonts.badge !== undefined)
    texts.push({
      text: `${card.count} change${card.count === 1 ? "" : "s"}`,
      x: 14,
      y: 22 + fonts.title + 6,
      fontSize: fonts.badge,
      color: dim,
      role: "badge",
    });
  if (fonts.body !== undefined && card.inCut)
    texts.push({
      text: "in the cut",
      x: 14,
      y: UNIT_NODE_H - 12,
      fontSize: fonts.body,
      color: "#c9a227",
      role: "body",
    });
  return texts;
}

/** The map at one zoom as static SVG — the artifact the LOD test asserts over. */
export function renderUnitsMapSvg(
  cards: UnitCardData[],
  positions: Map<string, { x: number; y: number }>,
  zoom: number,
  rep: Representation,
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const nodes = cards
    .map((c) => {
      const p = positions.get(c.id) ?? { x: 0, y: 0 };
      const texts = unitsNodeSpec(c, rep)
        .map(
          (t) =>
            `<text x="${t.x}" y="${t.y}" font-size="${t.fontSize}"${t.weight ? ` font-weight="${t.weight}"` : ""} fill="${t.color}" data-role="${t.role}">${esc(t.text)}</text>`,
        )
        .join("");
      return `<g transform="translate(${p.x},${p.y})" data-unit="${c.id}"><rect width="${UNIT_NODE_W}" height="${UNIT_NODE_H}" rx="10"/>${texts}</g>`;
    })
    .join("");
  return `<g transform="scale(${zoom})" data-zoom="${zoom}">${nodes}</g>`;
}
