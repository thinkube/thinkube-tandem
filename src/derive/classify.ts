/**
 * List-paste detection — the one thing a typed utterance is examined for.
 *
 * Nothing else is guessed about it. There was once a classifier here that
 * decided whether what you typed was an ask, a question, a rule or an
 * operation; three of those four have been removed and the fourth is what
 * everything already was, so a round that spent a model call to reach a
 * foregone conclusion went with them.
 */

export function splitList(text: string): string[] | null {
  const items: string[] = [];
  let markers = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^(\d+[.)]|[-*•])\s+/.test(t)) {
      markers++;
      items.push(t.replace(/^\d+[.)]\s+/, "").replace(/^[-*•]\s+/, "").trim());
    } else if (items.length) {
      // A wrapped continuation of the item above it — fold, never split.
      items[items.length - 1] += " " + t;
    } else {
      items.push(t);
    }
  }
  // Two or more MARKED items is a list; unmarked multi-line stays one ask
  // (people write paragraphs).
  if (markers < 2 || items.length < 2) return null;
  return items.filter(Boolean);
}
