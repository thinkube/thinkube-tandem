/**
 * What the look found, waiting on the writing page as sentences you can keep.
 *
 * The complaint that started this was never "a check failed". It was seeing
 * the delivered thing, wanting it fixed, and facing the whole way round
 * again: write the asks, read them, ground them, cut, sign, run. Four hours
 * to say what took ten seconds to notice — and the same number of asks as
 * the first time, because nothing carried over.
 *
 * So a finding lands where a new ask is written, already written. The
 * writing page is the one place in this system where the person's own words
 * become work, and it stays that way: nothing here records an ask, amends
 * one, or signs anything. The sentences sit in the draft until a person
 * reads them and presses Keep, and deleting a line is the whole cost of
 * disagreeing.
 *
 * It never amends the ask it came from. An amendment supersedes the
 * person's own sentence, and a machine replacing what somebody asked for
 * with what a worker noticed is the one move this must never make.
 */
import type { Finding } from "./theLook";

/** One finding as a line a person can keep, or delete, or rewrite. The ask
 *  it came from rides along so the sentence carries its own history — and
 *  so a reader can tell at a glance which of their asks came back. */
function asLine(f: Finding): string {
  const ask = f.where.split(" · ").slice(1).join(" · ").trim();
  return ask ? `${f.said} (seen after asking: ${ask})` : f.said;
}

/**
 * The findings appended to whatever is already being written.
 *
 * Appended, never substituted: a person mid-sentence when a deploy settles
 * must not lose the sentence. A finding already on the page is not written
 * twice — a second look after a second deploy repeats what is still wrong,
 * and repeating it would grow the page instead of the truth.
 */
export function draftWithFindings(draft: string, found: readonly Finding[]): string {
  if (!found.length) return draft;
  const had = draft.trim();
  const already = new Set(
    had.split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean),
  );
  const lines = [...new Set(found.map(asLine))].filter((l) => !already.has(l.trim().toLowerCase()));
  if (!lines.length) return draft;
  return had ? `${had}\n${lines.join("\n")}` : lines.join("\n");
}
