/**
 * What counts as one ask.
 *
 * A thinking space is a list of asks, so the box you write it in is a
 * list too: ONE LINE IS ONE ASK. This is the whole rule, and it lives
 * here rather than in the surface because the surface shows it to you
 * live, the host records by it, and a rule with two implementations is
 * two rules.
 *
 * The one wrinkle is a pasted list whose items wrap. Copied out of a
 * document, item 2 can arrive as two lines, and splitting blindly would
 * make a fragment into an ask of its own. So when markers are present, a
 * line without one belongs to the marked line above it — it is a wrapped
 * bullet, not a new ask. With no markers anywhere, every non-empty line
 * stands alone.
 */

const MARKED = /^\s*(\d+[.)]|[-*•])\s+/;

/** One entry per ask: its words, and which lines of the text carry it. */
export function asksOfText(text: string): { text: string; lines: number[] }[] {
  const raw = text.split("\n");
  const marked = raw.filter((l) => MARKED.test(l)).length;
  const out: { text: string; lines: number[] }[] = [];
  raw.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const stripped = t.replace(MARKED, "");
    if (marked >= 2 && !MARKED.test(line) && out.length) {
      const last = out[out.length - 1];
      last.text += " " + stripped;
      last.lines.push(i);
      return;
    }
    out.push({ text: stripped, lines: [i] });
  });
  return out;
}

/** The ask each line belongs to, 1-based; 0 where a line carries none. */
export function askOfLine(text: string): number[] {
  const map = new Array(text.split("\n").length).fill(0);
  asksOfText(text).forEach((a, n) => a.lines.forEach((l) => (map[l] = n + 1)));
  return map;
}
