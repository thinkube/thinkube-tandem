/**
 * The panel registry: one panel per thinking space key, so several spaces
 * stay open at once. A panel is made once per key and reused on every
 * later open() for that key; when a panel reports itself disposed (its
 * own tab closed), the registry drops the key so the next open() for that
 * space asks the factory for a fresh panel.
 */
import { TandemSession } from "./session";

/** The surface of a panel the registry actually drives — small enough
 *  for a test double to implement without a real editor window. */
export interface SpacePanelLike {
  dispose(): void;
  pushFrom(session: TandemSession, message?: string): void;
  /** Optional: not every fake panel reports its own disposal. */
  onDidDispose?(cb: () => void): void;
}

export class SpacePanels {
  private readonly make: (key: string, title: string) => SpacePanelLike;
  private readonly panels = new Map<string, SpacePanelLike>();

  constructor(make: (key: string, title: string) => SpacePanelLike) {
    this.make = make;
  }

  /** Reuse the panel already held for this key, or make one and remember
   *  it — subscribing to its disposal so a closed tab drops the key. */
  open(key: string, title: string): SpacePanelLike {
    const existing = this.panels.get(key);
    if (existing) return existing;
    const panel = this.make(key, title);
    this.panels.set(key, panel);
    panel.onDidDispose?.(() => {
      this.panels.delete(key);
    });
    return panel;
  }

  /** Post the session's state to the one panel registered for this key.
   *  A key with no open panel is a no-op — never an error. */
  pushTo(key: string, session: TandemSession, message?: string): void {
    this.panels.get(key)?.pushFrom(session, message);
  }

  /** Disposes and drops the one panel held for this key, leaving every
   *  other space's panel exactly as it was. A key with no open panel is a
   *  no-op. */
  dispose(key: string): void {
    const panel = this.panels.get(key);
    if (!panel) return;
    this.panels.delete(key);
    panel.dispose();
  }

  disposeAll(): void {
    for (const panel of this.panels.values()) panel.dispose();
    this.panels.clear();
  }
}
