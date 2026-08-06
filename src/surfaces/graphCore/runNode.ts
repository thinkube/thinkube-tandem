/**
 * The run-unit card, as data — the orchestration flow view's node on the
 * SAME shared graph-core the units map uses (TEP-22: one graph-core, no
 * surface carries its own graph infrastructure). Which texts a card shows
 * at a given zoom representation, with the run-state palette; the React
 * surface maps this spec verbatim to SVG.
 */
import { Representation, fontSizesFor } from "./lod";
import { NodeTextSpec } from "./unitsNode";

export const RUN_NODE_W = 200;
export const RUN_NODE_H = 64;

/** The run-state palette — one source for every surface that colors state. */
export const RUN_STATE_COLOR: Record<string, string> = {
  ready: "#8b949e",
  running: "#3fb950",
  parked: "#d29922",
  done: "#58a6ff",
  failed: "#f85149",
};

export interface RunCardData {
  id: string;
  slice: string;
  role: string;
  state: string;
  /** Milliseconds since the unit started running (running/parked only). */
  elapsedMs?: number;
}

/** `3m 12s` — elapsed, humanly. */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function runNodeSpec(card: RunCardData, rep: Representation): NodeTextSpec[] {
  const fonts = fontSizesFor(rep);
  const fg = "var(--vscode-foreground, #ddd)";
  const dim = "var(--vscode-descriptionForeground, #aaa)";
  const title = card.id.length > 26 ? card.id.slice(0, 25) + "…" : card.id;
  const texts: NodeTextSpec[] = [
    {
      text: title,
      x: 12,
      y: rep === "far" ? RUN_NODE_H / 2 + fonts.title / 3 : 20,
      fontSize: fonts.title,
      weight: 600,
      color: fg,
      role: "title",
    },
  ];
  if (fonts.badge !== undefined) {
    const elapsed =
      card.elapsedMs !== undefined && (card.state === "running" || card.state === "parked")
        ? ` · ${formatElapsed(card.elapsedMs)}`
        : "";
    texts.push({
      text: `${card.role} · ${card.state}${elapsed}`,
      x: 12,
      y: 20 + fonts.title + 8,
      fontSize: fonts.badge,
      color: card.state === "failed" ? RUN_STATE_COLOR.failed : dim,
      role: "badge",
    });
  }
  return texts;
}
