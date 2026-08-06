/**
 * Resolve the `.claude` scope a config CRUD action targets (SP-tgvhfk_SL-2).
 *
 * The Configuration view follows the navigator selection, so a create/delete
 * action with no explicit tree-item should write into the *selected* Thinking
 * Space — not a separately-set "active project". Precedence:
 *   explicit tree-item path  >  navigator-selected repo  >  active context
 * (the active context stays the chat-panel fallback). Pure + vscode-free so it
 * is unit-testable under node:test.
 */
export function resolveConfigTarget(
  itemPath: string | undefined,
  selectedRepoPath: string | undefined,
  activeContext: string | undefined,
): string | undefined {
  return itemPath || selectedRepoPath || activeContext;
}
