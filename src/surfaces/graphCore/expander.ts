/**
 * The in-canvas text expander. Expansion state lives in an id-keyed store,
 * decoupled from layout: an ELK reflow recomputes geometry, the store keeps
 * the expanded set, so a re-render reads the same state back by node id.
 * The full text is always element BODY content — never carried only by a
 * tooltip or title attribute.
 */

export interface ExpansionStore {
  isExpanded(id: string): boolean;
  toggle(id: string): void;
  setExpanded(id: string, expanded: boolean): void;
  expandedIds(): string[];
  /** Subscribe to changes (the React binding uses this); returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createExpansionStore(
  initial?: Iterable<string>,
): ExpansionStore {
  const expanded = new Set<string>(initial ?? []);
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    isExpanded: (id) => expanded.has(id),
    toggle: (id) => {
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      notify();
    },
    setExpanded: (id, on) => {
      if (on) expanded.add(id);
      else expanded.delete(id);
      notify();
    },
    expandedIds: () => [...expanded],
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export interface ExpandableLabel {
  /** What renders as the element's body content. */
  body: string;
  full: string;
  truncated: boolean;
  expanded: boolean;
  /** The single-interaction affordance; null when the text already fits. */
  expander: { label: string; action: "toggle" } | null;
}

export function expandableLabel(args: {
  text: string;
  maxChars: number;
  expanded: boolean;
}): ExpandableLabel {
  const truncated = args.text.length > args.maxChars;
  const expanded = truncated && args.expanded;
  return {
    body:
      !truncated || expanded
        ? args.text
        : args.text.slice(0, Math.max(1, args.maxChars - 1)) + "…",
    full: args.text,
    truncated,
    expanded,
    expander: truncated
      ? { label: expanded ? "less" : "more…", action: "toggle" }
      : null,
  };
}

/** Word-aware line wrap for an expanded body rendered as stacked texts. */
export function wrapBody(text: string, chars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > chars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/**
 * The canvas-markup seam: one node label as SVG. Expanded labels render
 * their COMPLETE text as <text> body lines; the collapsed form carries the
 * truncated body plus the activatable expander element. No <title> and no
 * title attribute ever carries the full text.
 */
export function renderNodeLabelMarkup(
  model: { id: string; text: string; maxChars: number; expanded: boolean },
  layout: { x: number; y: number },
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const label = expandableLabel({
    text: model.text,
    maxChars: model.maxChars,
    expanded: model.expanded,
  });
  const lines = label.expanded
    ? wrapBody(label.body, model.maxChars)
    : [label.body];
  const texts = lines
    .map(
      (l, i) =>
        `<text x="0" y="${i * 14}" font-size="12" data-label-line>${esc(l)}</text>`,
    )
    .join("");
  const expander = label.expander
    ? `<text x="0" y="${lines.length * 14}" font-size="11" data-expander="${model.id}" role="button">${esc(label.expander.label)}</text>`
    : "";
  return `<g transform="translate(${layout.x},${layout.y})" data-node-label="${model.id}">${texts}${expander}</g>`;
}
