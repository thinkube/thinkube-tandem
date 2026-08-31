/**
 * Grouping the subjects into things worth delivering on their own.
 *
 * Nineteen asks about one surface became one cut: sixty-two promises, forty-one
 * slices, one gate, one delivery, three days. The correction that turns a
 * tricycle into a car happens BETWEEN deliveries, and there was one. Had the
 * five asks about layout shipped alone, the window would have opened one
 * centimetre high on the first afternoon and the other fourteen would have
 * been built on a surface that worked.
 *
 * Files cannot make this grouping. Measured on the run that failed, clustering
 * the slices by the files they share gives one blob of seventeen out of
 * twenty-three: seventy-two percent of slice pairs touch a common file, and
 * removing the twelve most-shared files does not separate them. That is what a
 * surface IS. Files answer "what may run at the same time"; they say nothing
 * about what is worth delivering together.
 *
 * Subjects cannot make it either, alone: seventeen subjects over nineteen asks
 * gave seventeen groups, because a subject is one ask's noun phrase — "the tab
 * row", "the tab", "a panel". The grouping is one level up, and it is a
 * judgement about meaning, so it is proposed here and corrected by the person.
 * It happens on the first screen, before any grounding: the cheapest point in
 * the system, and the one that decides whether the work arrives in one piece
 * or five.
 */
import type { Claim, Space, Spec, Subject } from "../core/schema";
import type { RoundDeps } from "./round";
import { runReadRound } from "./round";

/** A proposal, before the person has agreed to it. */
export interface ProposedSpecs {
  specs: { name: string; subjectIds: string[] }[];
  /** Subjects the round left out — carried so none is silently dropped. */
  loose: string[];
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function specsPrompt(subjects: readonly Subject[], claims: readonly Claim[]): string {
  const claimsOf = (id: string): string[] =>
    claims.filter((c) => c.subjectId === id).map((c) => c.text);
  return [
    "These are the SUBJECTS of one person's asks — their own nouns, and what they want",
    "to become true of each. Group them into a few sets that make sense to BUILD AND",
    "SHOW SEPARATELY.",
    "",
    ...subjects.map(
      (s, i) => `${i + 1}. ${s.name}\n     ${claimsOf(s.id).map((c) => `— ${c}`).join("\n     ") || "— (nothing said yet)"}`,
    ),
    "",
    "A good set is one a person could look at on its own and say whether it is better.",
    "Prefer three to six sets. A set of one is fine when nothing else belongs with it.",
    "",
    "Name each set as an outcome in the person's own register — what becomes true when",
    "it is delivered: \"I can read the run graph\", \"the layout is stable\". Never a",
    "category, never a component name, never a noun on its own.",
    "",
    "Every subject appears in exactly one set. Do not invent subjects.",
    "",
    'Answer as JSON only: {"specs":[{"name":"…","subjects":[1,4,9]}]} — numbers are the',
    "positions above.",
  ].join("\n");
}

/**
 * Ask for the grouping. Fail-soft: a round that answers nothing leaves the
 * space exactly as it was, because a bad grouping is worse than none and the
 * person can always make it themselves.
 */
export async function proposeSpecs(
  deps: RoundDeps,
  space: Pick<Space, "subjects" | "claims">,
  round: typeof runReadRound = runReadRound,
): Promise<ProposedSpecs | undefined> {
  const subjects = space.subjects ?? [];
  if (subjects.length < 2) return undefined;
  const raw = await round(deps, specsPrompt(subjects, space.claims ?? []));
  const parsed = raw ? parseJson(raw) : undefined;
  const proposed = Array.isArray(parsed?.specs) ? (parsed!.specs as unknown[]) : [];
  const taken = new Set<string>();
  const specs: { name: string; subjectIds: string[] }[] = [];
  for (const p of proposed) {
    if (typeof p !== "object" || p === null) continue;
    const rec = p as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const at = Array.isArray(rec.subjects) ? rec.subjects : [];
    const subjectIds = at
      .map((n) => (typeof n === "number" ? subjects[n - 1] : undefined))
      // One subject belongs to one set: a subject in two sets is in two
      // deliveries, and the second one rebuilds what the first delivered.
      .filter((s): s is Subject => !!s && !taken.has(s.id))
      .map((s) => (taken.add(s.id), s.id));
    if (name && subjectIds.length) specs.push({ name, subjectIds });
  }
  if (!specs.length) return undefined;
  return { specs, loose: subjects.filter((s) => !taken.has(s.id)).map((s) => s.id) };
}

/**
 * The proposal as specs the space can hold.
 *
 * Subjects the round left out are not dropped: they become a set of their own,
 * named plainly, so nothing a person asked for can vanish because a grouping
 * round did not mention it.
 */
export function specsFrom(proposed: ProposedSpecs, mint: (n: number) => string): Spec[] {
  const specs = proposed.specs.map((s, i) => ({ id: mint(i + 1), name: s.name, subjectIds: s.subjectIds }));
  if (proposed.loose.length)
    specs.push({
      id: mint(specs.length + 1),
      name: "everything else you asked for",
      subjectIds: proposed.loose,
    });
  return specs;
}

/**
 * The promises a spec covers.
 *
 * A spec groups SUBJECTS, because subjects exist on the first screen in the
 * person's own nouns and promises do not exist yet. The path from one to the
 * other is the space's own: a subject names the asks it came from, and a
 * promise says which asks it serves.
 *
 * A promise serving asks from two specs belongs to both, and is returned for
 * both — the specs are a grouping of what the person asked for, not a
 * partition of the code. Whichever is built first carries it; the second
 * finds it already kept.
 */
export function promisesOfSpec(space: Pick<Space, "nodes" | "subjects">, spec: Spec): string[] {
  const subjects = new Set(spec.subjectIds);
  const asks = new Set(
    (space.subjects ?? []).filter((s) => subjects.has(s.id)).flatMap((s) => s.from),
  );
  return space.nodes.filter((n) => n.serves.some((a) => asks.has(a))).map((n) => n.id);
}
