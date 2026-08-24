/**
 * The registry of open space tabs, keyed by space. Opening a space brings
 * its own tab forward if one is already open, or builds a new one beside
 * the others — a tab never repaints under a different space's key.
 */

export interface SpaceTab {
  readonly key: string;
  readonly title: string;
  reveal(): void;
  push(state: unknown): void;
  onDisposed(cb: () => void): void;
  dispose(): void;
}

export class SpaceTabs {
  private readonly tabs = new Map<string, SpaceTab>();

  constructor(private readonly make: (key: string, title: string) => SpaceTab) {}

  /** Bring the key's tab forward, building one only the first time. */
  open(key: string, title: string): SpaceTab {
    const existing = this.tabs.get(key);
    if (existing) {
      existing.reveal();
      return existing;
    }
    const tab = this.make(key, title);
    this.tabs.set(key, tab);
    tab.onDisposed(() => {
      if (this.tabs.get(key) === tab) this.tabs.delete(key);
    });
    return tab;
  }

  get(key: string): SpaceTab | undefined {
    return this.tabs.get(key);
  }

  close(key: string): void {
    this.tabs.get(key)?.dispose();
  }

  keys(): string[] {
    return [...this.tabs.keys()];
  }

  /** Disposes every open tab and leaves the registry holding none. */
  dispose(): void {
    for (const tab of [...this.tabs.values()]) tab.dispose();
    this.tabs.clear();
  }
}
