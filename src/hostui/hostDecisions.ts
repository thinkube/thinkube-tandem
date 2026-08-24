/**
 * The decisions the host surfaces make, separated from the host APIs that
 * carry them out: what the status line says, what a change notice names and
 * targets, and which thinking-space rows are marked open.
 *
 * These rules answer questions about many spaces at once — every session's
 * activity, every open tab — so they must never read "the active session".
 * Keeping them free of any `vscode` import is what lets them be driven
 * directly: the host modules below decide nothing, they only render what
 * these functions return.
 */

/** One session's state, reduced to what the status line reads. */
export interface SessionStatus {
  /** A run is in flight for this space. */
  running: boolean;
  /** Units of this space's run, when it has one. */
  units?: { state: string }[];
  /** Workers of this space's run that are stopped, waiting on a person. */
  parked?: unknown[];
  /** Grounding rows; a row labelled "waiting" is not yet thinking. */
  grounding?: { label: string }[];
  /** Plain activity, when nothing heavier is in flight. */
  activity?: { label: string; current: number; total: number };
}

/** What the status line should show: its text and whether it must warn. */
export interface StatusLine {
  text: string;
  /** True when some space is stopped waiting on a person. */
  warning: boolean;
}

/**
 * The status line for ALL sessions at once. A space waiting on an answer
 * and a space still building are said in the same line, so neither hides
 * the other; a parked space is counted as waiting only, never also as
 * building, which would report one space twice.
 */
export function statusLine(sessions: SessionStatus[]): StatusLine | undefined {
  const parked = sessions.filter((s) => s.running && !!s.units && !!s.parked?.length);
  const building = sessions.filter((s) => s.running && !!s.units && !s.parked?.length);

  if (parked.length || building.length) {
    const parts: string[] = [];
    if (parked.length)
      parts.push(
        parked.length === 1
          ? `a worker needs your answer`
          : `${parked.length} workers need your answer`,
      );
    if (building.length) {
      if (building.length === 1) {
        const units = building[0].units!;
        const done = units.filter((u) => u.state === "done").length;
        parts.push(`building — ${done}/${units.length} units`);
      } else {
        parts.push(`building — ${building.length} spaces`);
      }
    }
    return {
      text: `${parked.length ? "$(warning)" : "$(sync~spin)"} Tandem: ${parts.join("; ")}`,
      warning: parked.length > 0,
    };
  }

  const grounding = sessions.filter((s) => (s.grounding?.length ?? 0) > 0);
  if (grounding.length) {
    if (grounding.length === 1) {
      const g = grounding[0].grounding!;
      const running = g.filter((row) => row.label !== "waiting").length;
      return { text: `$(sync~spin) Tandem: thinking about ${running} of ${g.length} asks`, warning: false };
    }
    return { text: `$(sync~spin) Tandem: thinking — ${grounding.length} spaces`, warning: false };
  }

  const busy = sessions.filter((s) => s.activity);
  if (busy.length) {
    if (busy.length === 1) {
      const a = busy[0].activity!;
      return { text: `$(sync~spin) Tandem: ${a.label}… (${a.current}/${a.total})`, warning: false };
    }
    return { text: `$(sync~spin) Tandem: working — ${busy.length} spaces`, warning: false };
  }
  return undefined;
}

/**
 * What the status line reads out of ONE session. The host holds sessions,
 * not status rows: this is the step that turns a session into a row, and
 * it is the step where "the active session" could creep back in — so it
 * takes a single session and can say nothing about which one is in front.
 */
export function sessionStatusOf(session: {
  running: boolean;
  runState?: { view(): { units: { state: string }[]; parked: unknown[] } };
  groundingView(): { label: string }[];
  activity?: { label: string; current: number; total: number };
}): SessionStatus {
  const v = session.runState?.view();
  return {
    running: session.running,
    ...(v ? { units: v.units, parked: v.parked } : {}),
    grounding: session.groundingView(),
    ...(session.activity ? { activity: session.activity } : {}),
  };
}

/** Split "<ownerId>/<slug>"; a work-project owner key keeps its "wp:". */
export function splitSessionKey(sessionKey: string): { ownerId: string; slug: string } {
  const i = sessionKey.lastIndexOf("/");
  return { ownerId: sessionKey.slice(0, i), slug: sessionKey.slice(i + 1) };
}

/** A notice raised by a change, and the space its open gesture targets. */
export interface ChangeNotice {
  kind: "information" | "warning";
  text: string;
  /** Present only when the notice offers a way into a space. */
  open?: { action: string; ownerId: string; slug: string };
}

/**
 * The notice a change produces, named for the space the change happened in
 * — never the space in front. A delivery notice always carries the open
 * gesture for its OWN key, so acting on it cannot land in another space.
 */
export function changeNotice(
  sessionKey: string,
  label: string,
  message: string | undefined,
): ChangeNotice | undefined {
  if (!message) return undefined;
  if (message.startsWith("Delivery ready")) {
    const { ownerId, slug } = splitSessionKey(sessionKey);
    return {
      kind: "information",
      text: `Tandem — ${label}: ${message}`,
      open: { action: "thinkube-tandem.openThinkingSpace", ownerId, slug },
    };
  }
  if (message.startsWith("The run refused"))
    return { kind: "warning", text: `Tandem — ${message}` };
  return undefined;
}

/**
 * Whether a thinking-space row is marked open. Every space that has a tab
 * is marked, not one per owner — a person can hold several tabs open at
 * once, and marking only the last one chosen would deny the others exist.
 */
export function isSpaceOpen(openKeys: readonly string[], ownerKey: string, slug: string): boolean {
  return openKeys.includes(`${ownerKey}/${slug}`);
}

/**
 * The marking predicate the projects tree is actually given. It reads the
 * registry at the moment each row is drawn, so a tab opened or closed
 * since the last draw is reflected; binding a snapshot of the keys here
 * instead would freeze the marks at wiring time and show only the spaces
 * that happened to be open then.
 */
export function spaceOpenMarker(
  openKeys: () => readonly string[],
): (ownerKey: string, slug: string) => boolean {
  return (ownerKey, slug) => isSpaceOpen(openKeys(), ownerKey, slug);
}
