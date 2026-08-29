/**
 * The draft a person is writing, before any of it is an ask.
 *
 * Small, and one subject: what is typed is kept, what is read from it
 * becomes asks, and what has been read but not yet kept is still draft.
 * It sat in the session class because it is a gesture the surface makes;
 * it lives here because the session had grown past the size a person can
 * hold in their head, and a file is split at a subject, never shaved.
 */
import type { TandemSession } from "./session";

/** Keep what is typed. Spends nothing and reads nothing. */
export function saveDraftOn(s: TandemSession, text: string): void {
  s.space = { ...s.space, draft: text };
  s.persist();
}

/** The lines of the reading that have not yet become asks. */
export function draftReadOf(s: TandemSession): string[] {
  return (s.space.proposal?.texts ?? []).slice(s.space.asks.length);
}
