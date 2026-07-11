/**
 * Cross-thinking space tag clustering. Pure + vscode-free
 * so it's unit-testable; the thinking space-walk that produces the `TaggedItem`s lives
 * in the (vscode-stubbed) MCP server (`aggregateTagsAcrossThinkingSpaces`).
 */

export interface TaggedItem {
  /** The thinking space (Thinking Space) this item lives in — its canonical id. */
  thinkingSpaceId: string;
  /** The item's handle within its thinking space: `SP-{n}`, `SP-{n}_SL-{m}`, or `TEP-{id}`. */
  handle: string;
  kind: "spec" | "slice" | "tep";
  /** The item's effective tags (already folded via `effectiveTags`). */
  tags: string[];
}

/**
 * Group items by tag — an item carrying N tags appears under all N, so the same
 * item can cluster under several tags, and one tag clusters items from many
 * thinkingSpaces. Insertion order is preserved within each tag's bucket.
 */
export function groupByTag(items: TaggedItem[]): Map<string, TaggedItem[]> {
  const out = new Map<string, TaggedItem[]>();
  for (const it of items) {
    for (const tag of it.tags) {
      const arr = out.get(tag);
      if (arr) arr.push(it);
      else out.set(tag, [it]);
    }
  }
  return out;
}
