/**
 * The register of open thinking-space tabs, keyed by owner and slug
 * ("ownerKey/slug"): one tab per key, revealed when already open, built
 * fresh when not — and dropped the moment it reports itself closed.
 */

/** What the register needs from a tab: whether it is still alive, how to
 *  bring it to the front, how to close it, and how to deliver this space's
 *  own state into it. Nothing else is touched. */
export interface SpaceTab {
  isClosed(): boolean;
  reveal(): void;
  dispose(): void;
  push(payload: unknown): void;
}

export class SpaceTabs {
  private readonly tabs = new Map<string, SpaceTab>();

  constructor(private readonly factory: (key: string) => SpaceTab) {}

  /** Reveal the live tab for `key`, or build a fresh one when there is
   *  none — or the one on record has already been closed. */
  open(key: string): SpaceTab {
    const existing = this.tabs.get(key);
    if (existing && !existing.isClosed()) {
      existing.reveal();
      return existing;
    }
    const fresh = this.factory(key);
    this.tabs.set(key, fresh);
    return fresh;
  }

  /** The keys currently holding a live (not-yet-closed) tab. */
  liveKeys(): string[] {
    return [...this.tabs.entries()]
      .filter(([, tab]) => !tab.isClosed())
      .map(([key]) => key);
  }

  /** Deliver `payload` into `key`'s own tab and no other. A key with no
   *  registered tab, or whose tab now reports itself closed even though it
   *  is still on record, is silently a no-op — the same "closed is as good
   *  as absent" treatment `open` already gives a stale entry. */
  push(key: string, payload: unknown): void {
    const tab = this.tabs.get(key);
    if (!tab || tab.isClosed()) return;
    tab.push(payload);
  }

  /** Close `key`'s own tab, if one is registered — never builds a fresh
   *  one just to dispose it. What deleting a thinking space closes. */
  close(key: string): void {
    const tab = this.tabs.get(key);
    if (!tab) return;
    tab.dispose();
    this.tabs.delete(key);
  }

  dispose(): void {
    for (const tab of this.tabs.values()) tab.dispose();
    this.tabs.clear();
  }
}
