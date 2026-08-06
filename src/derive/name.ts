/**
 * The naming round (SPEC Stage 1: units "get titles"; two-faces principle:
 * every unit renders as a title + a decision-sized abstract). One batched
 * judgment round names every unit that needs it; the caller stamps the
 * result. Fail-soft: a broken round names nothing — the surface falls back
 * to the first member sentence ("fallback title always").
 */
import { RoundDeps, runReadRound } from "./round";

export const TITLE_MAX = 70;

export interface UnitToName {
  id: string;
  /** The member changes' human sentences — the inputs the render describes. */
  sentences: string[];
}

export interface NamedAbstract {
  unitId: string;
  title: string;
  text: string;
}

export function buildNamingPrompt(units: UnitToName[]): string {
  const list = units
    .map(
      (u) =>
        `unit ${u.id}:\n${u.sentences.map((s) => `  - ${s}`).join("\n")}`,
    )
    .join("\n");
  return (
    `You are naming units of work for a human who decides at a glance.\n` +
    `Each unit below is a cluster of intended code changes, one sentence per change.\n\n` +
    `${list}\n\n` +
    `For EACH unit produce:\n` +
    `- "title": a noun-phrase name for the unit as a whole, at most ${TITLE_MAX} characters. ` +
    `A name, not a sentence — no trailing period, never a copy of a member sentence.\n` +
    `- "text": a one-to-two sentence abstract of what the unit delivers as a whole, ` +
    `decision-sized. It must not repeat the title's wording.\n\n` +
    `Write BOTH in plain English: short sentences, common words, no method jargon ` +
    `and no internal identifiers. A non-programmer must understand every word.\n\n` +
    `Do not read any files. Answer with ONLY a JSON array, no prose:\n` +
    `[{"unitId": "...", "title": "...", "text": "..."}]`
  );
}

/** Strict-ish parse: unknown units drop, overlong titles clamp, junk → []. */
export function parseAbstracts(
  raw: string | null,
  validIds: ReadonlySet<string>,
): NamedAbstract[] {
  if (!raw) return [];
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: NamedAbstract[] = [];
  for (const e of parsed) {
    if (typeof e !== "object" || e === null) continue;
    const { unitId, title, text } = e as Record<string, unknown>;
    if (typeof unitId !== "string" || !validIds.has(unitId)) continue;
    if (typeof title !== "string" || !title.trim()) continue;
    const t = title.trim();
    out.push({
      unitId,
      title: t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t,
      text: typeof text === "string" ? text.trim() : "",
    });
  }
  return out;
}

export async function nameUnits(
  deps: RoundDeps,
  units: UnitToName[],
): Promise<NamedAbstract[]> {
  if (units.length === 0) return [];
  const raw = await runReadRound(
    { ...deps, maxTurns: 4 },
    buildNamingPrompt(units),
  );
  return parseAbstracts(raw, new Set(units.map((u) => u.id)));
}
