/**
 * Capture through the model: the pasted sentences become asks (the human's
 * words, kept whole), the model round proposes what they are about, and the
 * proposal waits for the human. Nothing is ground until they accept it —
 * a wrong reading costs one cheap round, not seven expensive ones.
 */
import { Claim, Space, Subject } from "../core/schema";
import { asksOfText } from "../derive/asks";
import { solveModel, unaccountedFor } from "../derive/model";
import type { TandemSession } from "./session";

/**
 * Record the sentences as asks, then ask the round what they are about. A
 * reading already waiting is NOT replaced: the new sentences join it and
 * the whole set is read again, because a list is one description and a
 * later sentence can change what the earlier ones were about.
 */
/**
 * Read everything this space holds: the sentences already recorded, then
 * whatever is still being written. Always together, never one alone — a
 * new sentence usually lands on a subject that already exists, and
 * reading it by itself would invent a second subject for the same thing.
 *
 * The draft's lines have no ids yet; their places are held empty until
 * the human keeps them.
 */
export function readEverything(s: TandemSession): Promise<{ ok: boolean; reason?: string }> {
  const fresh = asksOfText(s.space.draft ?? "").map((a) => a.text);
  return readModel(
    s,
    [...s.space.asks.map((a) => a.text), ...fresh],
    [...s.space.asks.map((a) => a.id), ...fresh.map(() => "")],
  );
}

export async function readModel(
  s: TandemSession,
  texts: string[],
  askIds: string[],
): Promise<{ ok: boolean; reason?: string }> {
  s.activity = { label: "reading your list as one description", current: 1, total: 1 };
  s.deps.onChanged?.();
  // The round's own failure lines are the diagnosis; without them a failed
  // reading is a mystery.
  const said: string[] = [];
  const model = await (s.deps.solveModel ?? solveModel)(
    { ...s.deps.round, log: (line) => said.push(line) },
    texts,
  ).catch((err: unknown) => {
    said.push(err instanceof Error ? err.message : String(err));
    return undefined;
  });
  s.activity = undefined;

  if (!model) {
    const reason =
      said.join("\n").trim() || "the round returned nothing I could read as subjects and claims";
    s.space = {
      ...s.space,
      proposal: undefined,
      readingFailure: { reason, texts, askIds },
    };
    s.changed("I could not read your list. Nothing was derived — your sentences are recorded and waiting.");
    return { ok: false, reason };
  }

  s.space = {
    ...s.space,
    readingFailure: undefined,
    proposal: { askIds, texts, ...model, missing: unaccountedFor(model, texts.length) },
  };
  s.changed(
    `${model.subjects.length} subject(s) — check them before I think about the code.`,
  );
  return { ok: true };
}

/** The human accepted: the proposal becomes the space's model. */
export function applyModel(
  space: Space,
  pending: NonNullable<Space["proposal"]>,
  author: string,
): Space {
  const subjects: Subject[] = [];
  const claims: Claim[] = [];
  const askOf = (n: number): string => pending.askIds[n - 1] ?? pending.askIds[0] ?? "";

  pending.subjects.forEach((sub, i) => {
    const id = `subject-${author}-${(space.subjects?.length ?? 0) + i + 1}`;
    subjects.push({ id, name: sub.name, from: sub.from.map(askOf) });
    sub.claims.forEach((c) => {
      claims.push({
        // One counter, one id: adding the position within the subject too
        // mints the same id twice and attaches promises to the wrong claim.
        id: `claim-${author}-${(space.claims?.length ?? 0) + claims.length + 1}`,
        subjectId: id,
        text: c.text,
        ...(c.why ? { why: c.why } : {}),
        fromAsk: askOf(c.from),
      });
    });
  });

  return {
    ...space,
    subjects: [...(space.subjects ?? []), ...subjects],
    claims: [...(space.claims ?? []), ...claims],
  };
}

