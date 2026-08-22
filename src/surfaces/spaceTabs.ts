/**
 * The register of open thinking-space tabs — one tab per owner-and-space
 * key. Opening a key with a live tab reveals it; opening a key with no
 * tab, or one that reports itself closed, builds a fresh one through the
 * caller's factory.
 */

/** The minimal shape a tab must offer the register — nothing more. */
export interface SpaceTab {
  reveal(): void;
  dispose(): void;
  isClosed(): boolean;
  /** Deliver this space's own push payload to the tab. */
  push?(payload: unknown): void;
}

export class SpaceTabs {
  private readonly tabs = new Map<string, SpaceTab>();

  open(key: string, factory: () => SpaceTab): SpaceTab {
    const existing = this.tabs.get(key);
    if (existing && !existing.isClosed()) {
      existing.reveal();
      return existing;
    }
    const tab = factory();
    this.tabs.set(key, tab);
    return tab;
  }

  /** True when `key` holds a live (not-closed) tab. */
  isOpen(key: string): boolean {
    const tab = this.tabs.get(key);
    return !!tab && !tab.isClosed();
  }

  /** Delivers `payload` only to the tab registered for `key`, if it is
   *  live. A key with no open tab is a silent no-op. */
  push(key: string, payload: unknown): void {
    const tab = this.tabs.get(key);
    if (!tab || tab.isClosed()) return;
    tab.push?.(payload);
  }

  /** Closes and drops the tab registered for `key`, if any — the same act
   *  that drops a deleted space's session must close its tab. */
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
