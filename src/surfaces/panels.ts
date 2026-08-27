/**
 * The panel registry: one panel per thinking space key, so several spaces
 * stay open at once. A panel is made once per key and reused on every
 * later open() for that key; when a panel reports itself disposed (its
 * own tab closed), the registry drops the key so the next open() for that
 * space asks the factory for a fresh panel.
 */
import type { TandemSession } from "./session";

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

/** The editor gestures a space's notice needs — injected, so the rule
 *  below runs without a running editor. */
export interface NoticeHost {
  info(text: string, action: string): Promise<string | undefined>;
  warn(text: string): void;
  run(command: string, ...args: unknown[]): void;
}

/**
 * What a space's message puts on screen, and what its button then opens.
 *
 * The button acts on `key` — the space the message came from — and on
 * nothing else: a delivery from a background space opens that space's own
 * tab, so the space in the foreground is never revealed in its place.
 * `key` is "<ownerKey>/<slug>"; an owner key may itself be "wp:<id>", so
 * the slug is taken after the FIRST slash.
 */
export async function notifyForSpace(
  host: NoticeHost,
  key: string,
  message?: string,
): Promise<void> {
  if (message?.startsWith("Delivery ready")) {
    const pick = await host.info(`Tandem — ${message}`, "Open the space");
    if (!pick) return;
    const slash = key.indexOf("/");
    if (slash <= 0 || slash === key.length - 1) return;
    host.run(
      "thinkube-tandem.openThinkingSpace",
      key.slice(0, slash),
      key.slice(slash + 1),
    );
    return;
  }
  if (message?.startsWith("The run refused")) host.warn(`Tandem — ${message}`);
}
