/**
 * A finding says what is; an ask says what the person wants.
 *
 * "Reaching the Create Task button takes 11 Tab presses" is a defect
 * description — nothing in it says what to build. Before a finding goes
 * into the capture box it is turned into a want, in the voice of the
 * person's own sentences: "The Create Task button is reachable in a few
 * Tab presses." The person edits it there like any line of theirs.
 *
 * A conversion that fails hands the finding over unchanged: a raw
 * observation in the box still beats a lost one.
 */
import { RoundDeps, runReadRound, volumeDeps } from "../derive/round";

export async function wantsFrom(
  findings: readonly string[],
  deps: RoundDeps,
  round: typeof runReadRound = runReadRound,
): Promise<string[]> {
  const reply = await round(
    volumeDeps(deps),
    [
      "Each line below describes something OBSERVED in a running product —",
      "a defect, a friction, something half done. Rewrite each as ONE plain",
      "sentence asking for the behaviour a person would want instead.",
      "",
      "Write it the way a person asks for things: what the product does for",
      "them, present tense, no jargon, no solution baked in. Keep a concrete",
      "measure when the observation has one; never invent numbers it does",
      "not.",
      "",
      "THE OBSERVATIONS:",
      ...findings.map((f, i) => `${i + 1}. ${f}`),
      "",
      `Answer with ONLY a JSON array of ${findings.length} strings, in the same order.`,
    ].join("\n"),
  );
  try {
    const parsed: unknown = JSON.parse((reply ?? "").replace(/^[^[]*/, "").replace(/[^\]]*$/, ""));
    if (Array.isArray(parsed) && parsed.length === findings.length && parsed.every((x) => typeof x === "string" && x.trim()))
      return parsed.map((x: string) => x.trim());
  } catch {
    /* the observations go over as they are */
  }
  return [...findings];
}
