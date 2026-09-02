/**
 * What a unit builds, read back from its brief.
 *
 * A worker's brief says what it builds in one sentence per promise: the
 * promise in the person's words, where it lands, and what must be true
 * when it is done. A tester's brief says each criterion under the promise
 * it proves. The run keeps that text as it was said; the surface reads it
 * back into its parts so a person sees a promise, a list of files and a
 * list of criteria rather than one unbroken line.
 */

interface Landing {
  path: string;
  /** The thing in the file, without its signature. */
  name?: string;
  /** The signature, when the brief gave one. */
  signature?: string;
  isNew?: boolean;
}

export interface Built {
  promise: string;
  lands: Landing[];
  criteria: string[];
}

function landingOf(text: string): Landing {
  const isNew = /\(new file\)\s*$/.test(text);
  const cleaned = text.replace(/\s*\(new file\)\s*$/, "").trim();
  const [path, ...rest] = cleaned.split(/\s*›\s*/);
  const symbol = rest.join(" › ").trim();
  if (!symbol) return { path: path.trim(), ...(isNew ? { isNew } : {}) };
  const name = symbol.replace(/\(.*$/s, "").replace(/\s*->.*$/, "").trim();
  const signature = symbol !== name ? symbol : undefined;
  return { path: path.trim(), name, ...(signature ? { signature } : {}), ...(isNew ? { isNew } : {}) };
}

/** Split on separators that sit between items, never inside a signature's parentheses. */
function splitOutside(text: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const m = sep.exec(text.slice(i));
      if (m && m.index === 0) {
        out.push(text.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** The criteria list: items separated by ";" and each ending in its own full stop. */
function criteriaOf(text: string): string[] {
  return text
    .split(/\.;\s*|;\s+(?=[A-Z"'“])/)
    .map((c) => c.trim().replace(/[.;]+$/, "").trim())
    .filter(Boolean)
    .map((c) => (/[.!?”"]$/.test(c) ? c : `${c}.`));
}

export function parseBrief(what: string | undefined): Built[] {
  if (!what?.trim()) return [];
  const lines = what.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // A tester's brief: `[promise] criterion.; [promise] criterion.` — grouped under the promise.
  if (lines.every((l) => /^\[/.test(l))) {
    const by = new Map<string, string[]>();
    for (const line of lines)
      for (const item of splitOutside(line, /;\s*/))
        {
          const m = /^\[(.+?)\]\s*(.*)$/s.exec(item);
          if (!m) continue;
          const list = by.get(m[1]) ?? [];
          const c = m[2].trim().replace(/[.;]+$/, "");
          if (c) list.push(/[.!?”"]$/.test(c) ? c : `${c}.`);
          by.set(m[1], list);
        }
    return [...by.entries()].map(([promise, criteria]) => ({ promise, lands: [], criteria }));
  }
  return lines.map((line) => {
    const [head, ...tail] = line.split(/\s+—\s+lands at\s+/);
    const afterLands = tail.join(" — lands at ");
    const [landsText, ...doneParts] = afterLands.split(/\s+—\s+done when:\s*/);
    const doneText = doneParts.join(" — done when: ");
    const lands = landsText ? splitOutside(landsText, /,\s+(?=[\w./-]+(?:\s*›|\s*\(new file\)|\s*,|\s*$))/).map(landingOf) : [];
    return {
      promise: head.trim().replace(/\s*—\s*$/, ""),
      lands,
      criteria: doneText ? criteriaOf(doneText) : [],
    };
  });
}
