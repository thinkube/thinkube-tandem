/**
 * Asking every green check whether it executed the code it is about.
 *
 * A passing check has proved something; WHAT it proved is a separate
 * question. An assertion can be satisfied by a stub, and a stub cannot
 * appear on a path nothing reaches — so each green check is run again with
 * the runtime reporting what it executed, and that is compared with the
 * files its promise lands in.
 *
 * The verdict has three values deliberately. "no" means the check ran and
 * touched none of its subject: a real finding. "unknown" means the runtime
 * said nothing this reader understands, which is a fact about the runtime,
 * not about the work. Reported as "no", it withheld seventeen promises for
 * code that was correct.
 */
import type { Space } from "../core/schema";
import { isTestPath } from "./testHomes";
import type { WiringVerdict } from "./wiring";
import { criterionMapOf } from "./criteria";
import { provedByExecution } from "./wiring";
import type { SliceForDag } from "../engine/core/dag";
import type { AcVerification } from "../engine/core/closingGate";

export async function traceWiring(a: {
  tep: string;
  space: Space;
  slices: SliceForDag[];
  acResults: readonly { ac: number; pass: boolean }[];
  verifs: readonly AcVerification[];
  probeOfAc: ReadonlyMap<number, string>;
  worktree: string;
  exec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  log: (line: string) => void;
  defect: (entry: {
    activity: string;
    trigger: string;
    type?: string;
    stage?: "author" | "brief" | "check" | "clearance" | "altitude";
    impact: string;
    detail: string;
  }) => void;
  mapCriteria: typeof criterionMapOf;
  proveWiring: typeof provedByExecution;
}): Promise<{
  wiring: Map<number, WiringVerdict>;
  /** Which criterion each probe belongs to — named by the CHECK it ran,
   *  because an ordinal names nothing to a reader. */
  criterionByProbe: Map<string, string>;
  /** The files a criterion's promise lands in, tests excluded. */
  subjectsOf: (criterionId?: string) => string[];
}> {
  // Named by the CHECK it ran — an ordinal names nothing to a reader.
  const criterionByProbe = a.mapCriteria(a.slices);
  // Wiring proven by execution: a green check is asked whether running it
  // actually executed the code its promise lands in. A stub satisfies an
  // assertion; it cannot appear on a path nothing reaches.
  const subjectsOf = (criterionId?: string): string[] => {
    if (!criterionId) return [];
    const promise = a.space.nodes.find((n) => n.acceptance.some((a) => a.id === criterionId));
    return (promise?.grounding?.touchpoints ?? []).map((t) => t.path).filter((p) => !isTestPath(p));
  };
  const wiring = new Map<number, WiringVerdict>();
  for (const r of a.acResults) {
    if (!r.pass) continue;
    const v = a.verifs.find((x) => x.ac === r.ac);
    if (!v?.run || v.env === "assessment") continue;
    const probe = a.probeOfAc.get(r.ac);
    const verdict = await a.proveWiring({
      run: v.run,
      subjects: subjectsOf(probe ? criterionByProbe.get(probe) : undefined),
      worktree: a.worktree,
      exec: a.exec,
    });
    wiring.set(r.ac, verdict);
    if (verdict.executed === "no")
      a.defect({
        activity: "closing gate",
        trigger: "wiring-trace",
        type: "code",
        stage: "author",
        impact: "a green check proved nothing",
        detail: verdict.detail.slice(0, 400),
      });
  }
  const unproven = [...wiring.values()].filter((w) => w.executed === "unknown").length;
  if (unproven) a.log(`${a.tep}: ${unproven} check(s) ran under a runtime that does not report what it executed — their wiring is unproven`);
  return { wiring, criterionByProbe, subjectsOf };
}
