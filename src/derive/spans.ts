/**
 * Spans: the quoted source lines behind a pointer.
 *
 * The handovers between rounds carry pointers — `path:L245`, `path ›
 * symbol` — and a pointer is not consumable knowledge: a round told to
 * JUDGE a list of call sites it cannot see re-reads the repository to
 * reconstruct what the sender already knew. These helpers turn a pointer
 * into a pointer PLUS the line it points at, so the receiver can judge
 * without re-reading.
 *
 * LANGUAGE-AGNOSTIC BY RULE: nothing here interprets source text. A span
 * is sliced by the line number the code graph provided, or found by
 * matching the literal symbol string; there is no notion of declaration,
 * import or grammar. When neither line nor literal match is available the
 * pointer travels alone — never a guess.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Anchor } from "../core/schema";

/** A quoted line is context, not a document. */
const MAX_LINE_CHARS = 160;
/** Enrichment must never dominate the prompt it rides in. */
const MAX_TOTAL_CHARS = 32_000;

const clip = (s: string): string =>
  s.length > MAX_LINE_CHARS ? `${s.slice(0, MAX_LINE_CHARS)}…` : s;

function linesOf(root: string, rel: string): string[] | undefined {
  try {
    const abs = path.join(root, rel);
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return undefined;
    return fs.readFileSync(abs, "utf8").split("\n");
  } catch {
    return undefined;
  }
}

/** The line at `path:Lnn`, quoted verbatim (1-based, as graphify counts). */
function quoteAt(root: string, rel: string, line: number): string | undefined {
  const lines = linesOf(root, rel);
  if (!lines || line < 1 || line > lines.length) return undefined;
  const text = lines[line - 1].trim();
  return text ? clip(text) : undefined;
}

/**
 * The line where an anchor's symbol lives, by literal match — the first
 * line containing the symbol string. Planned anchors have no source yet
 * and return nothing.
 */
export function quoteAnchor(
  root: string,
  anchor: Anchor,
  scopeDir?: (scope: string) => string | undefined,
): string | undefined {
  if (anchor.planned || !anchor.symbol) return undefined;
  const base = anchor.scope ? scopeDir?.(anchor.scope) : root;
  if (!base) return undefined;
  const lines = linesOf(base, anchor.path);
  if (!lines) return undefined;
  const hit = lines.find((l) => l.includes(anchor.symbol!));
  const text = hit?.trim();
  return text ? clip(text) : undefined;
}

/**
 * Rewrite an affected-by listing so every `path:Lnn` entry carries the
 * line it names. Lines that carry no locator pass through untouched, and
 * the whole result is bounded — past the cap the remaining entries travel
 * as pointers, which is what they were.
 */
export function enrichAffected(root: string, affected: string): string {
  if (!affected.trim()) return affected;
  let spent = 0;
  return affected
    .split("\n")
    .map((line) => {
      if (spent >= MAX_TOTAL_CHARS) return line;
      const m = /(\S+):L(\d+)\s*$/.exec(line);
      if (!m) return line;
      const quoted = quoteAt(root, m[1], Number(m[2]));
      if (!quoted) return line;
      spent += quoted.length;
      return `${line}\n    > ${quoted}`;
    })
    .join("\n");
}
