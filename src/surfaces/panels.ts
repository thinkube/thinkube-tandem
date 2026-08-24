/**
 * The tab registry: one editor tab per thinking space, keyed by the space's
 * own key (owner + slug). Opening a key that already has a tab reveals that
 * tab instead of making a second one — the machine cannot see a VS Code
 * editor tab, so this registry, not any inspection of the editor, is the
 * one place that answers "which spaces are open right now" (projects-tree
 * marking, delivery notices, the status line all read it).
 *
 * A tab is whatever the host factory returns; this module only requires
 * `reveal`, `push`, and `dispose`. `onDidDispose` is optional because not
 * every tab (real or test double) reports host-side disposal — when it is
 * missing, the registry simply cannot learn the tab closed on its own and
 * the key stays listed until `close` is called explicitly.
 */

export interface SpaceTab {
  /** Bring this space's tab to the front without rebuilding it. */
  reveal(): void;
  /** Send this space's own state to its tab, and no other. */
  push(payload: unknown): void;
  /** Tear the tab down from the host side (the registry-initiated close). */
  dispose(): void;
  /** Host-reported disposal (the person closed the tab by hand). Optional:
   *  not every host surface offers this signal. */
  onDidDispose?(cb: () => void): void;
}

/**
 * One tab per open thinking space key. `make` builds a fresh tab; the
 * registry decides only WHEN to call it — never open twice for the same
 * key.
 */
export class SpaceTabs {
  private readonly tabs = new Map<string, SpaceTab>();

  constructor(private readonly make: (key: string, title: string) => SpaceTab) {}

  /** Reveal the key's existing tab, or build one via the factory. */
  open(key: string, title: string): SpaceTab {
    const existing = this.tabs.get(key);
    if (existing) {
      existing.reveal();
      return existing;
    }
    const tab = this.make(key, title);
    this.tabs.set(key, tab);
    tab.onDidDispose?.(() => {
      this.tabs.delete(key);
    });
    return tab;
  }

  /** Host-initiated close: dispose the one tab under this key, no other. */
  close(key: string): void {
    const tab = this.tabs.get(key);
    if (!tab) return;
    this.tabs.delete(key);
    tab.dispose();
  }

  /** Deliver a payload to the one tab registered under this key. Does
   *  nothing, and raises nothing, when that key has no open tab. */
  pushTo(key: string, payload: unknown): void {
    this.tabs.get(key)?.push(payload);
  }

  /** Every space key that currently has an open tab. */
  keys(): string[] {
    return [...this.tabs.keys()];
  }

  /** Tear every open tab down — the extension is deactivating. */
  disposeAll(): void {
    for (const tab of this.tabs.values()) tab.dispose();
    this.tabs.clear();
  }
}
