/**
 * Think again: withdraw the signed cut that delivered nothing, and derive
 * its promises anew under every rule and decision now in force.
 *
 * A signed cut with no delivery is otherwise a dead end — runnable, never
 * re-thinkable — and a run that ended without a delivery leaves exactly
 * that behind. A withdrawn cut freezes nothing and runs nothing; nothing
 * delivered and accepted is ever withdrawn.
 */
import type { TandemSession } from "./session";
import { sweepSpaceResidue } from "../run/residue";
import { defaultExec } from "../run/oracle";

export async function thinkAgainFlow(
  s: TandemSession,
  subjectsOfAsk: (id: string) => string[],
  rederiveSubjects: (ids: string[]) => Promise<void>,
): Promise<{ ok: boolean; reason?: string }> {
  const c = s.unrunCut();
  if (!c) return { ok: false, reason: "there is no signed work to think again about" };
  if (s.running) return { ok: false, reason: "a run is in flight — stop it first" };
  const cut = s.space.cuts.find((x) => x.id === c.id)!;
  if (s.space.deliveries.some((d) => d.cutId === cut.id && d.acceptedAt))
    return { ok: false, reason: "that cut was delivered and accepted — it cannot be withdrawn" };
  s.space = {
    ...s.space,
    cuts: s.space.cuts.map((x) => (x.id === cut.id ? { ...x, withdrawnAt: s.deps.now() } : x)),
  };
  const subjects = [...new Set(cut.changeIds.flatMap((id) => subjectsOfAsk(id)))];
  const byClaim = new Set(
    s.space.nodes
      .filter((n) => cut.changeIds.includes(n.id) && n.servesClaim)
      .map((n) => (s.space.claims ?? []).find((cl) => cl.id === n.servesClaim)?.subjectId)
      .filter((x): x is string => !!x),
  );
  const all = [...new Set([...subjects, ...byClaim])];
  if (!all.length) return { ok: false, reason: "the cut's promises belong to no subject that can be derived again" };
  await rederiveSubjects(all);
  // The run of a withdrawn cut is work against promises that no longer
  // exist: the next cut mints its own number and never resumes this
  // branch, so leaving it is leaving a tree nobody will ever open again.
  const swept = await sweepRun(s, cut.tepId);
  s.changed(
    `${cut.tepId ?? cut.id} withdrawn — its promises are being thought through again.` +
      (swept.length ? ` Its run was cleared: ${swept.join(", ")}.` : ""),
  );
  return { ok: true };
}

/** Everything the withdrawn cut's run left beside the repository. */
async function sweepRun(s: TandemSession, tepId: string | undefined): Promise<string[]> {
  if (!tepId) return [];
  const repoRoot = s.deps.round.repoRoot;
  const listed = await defaultExec("git", ["-C", repoRoot, "branch", "--list", `*${tepId}`], repoRoot);
  const branches = listed.out
    .split("\n")
    .map((l) => l.replace(/^[*+ ]+/, "").trim())
    .filter((b) => b.startsWith("tandem/"));
  const r = await sweepSpaceResidue({ repoRoot, teps: [tepId], branches });
  return [...r.removed, ...r.notes];
}
