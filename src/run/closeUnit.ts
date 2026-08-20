/**
 * The closer, for one unit: the last actor before a unit is declared failed.
 *
 * It is handed everything the unit's own rungs could not settle — the
 * checks in full, the tree, what was already tried — and is judged by the
 * same oracle as the coder it replaces (THE-LADDER §4).
 */
import * as path from "node:path";
import { formatVerifyReply } from "../engine/verifyOracle";
import type { VerifyOracle } from "../engine/verifyOracle";
import type { AcVerification } from "../engine/core/closingGate";
import type { RunState } from "./state";
import type { Exec } from "./oracle";
import type { DispatchDeps } from "./dispatch";
import { close, readProbes } from "./closer";

export interface UnitForClosing {
  id: string;
  slice: string;
  footprint: string[];
}

export function unitCloser(a: {
  worktree: string;
  testerWt: string;
  sliceProbes: ReadonlyMap<string, string[]>;
  sliceVerifs: ReadonlyMap<string, AcVerification[]>;
  criterionOf: (slice: string, ac: number) => { id: string; text: string } | undefined;
  st: RunState;
  exec: Exec;
  boundedExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  log: (line: string, step?: string) => void;
  deps: DispatchDeps;
  rulings: { criterionId: string; unit: string; granted: boolean; reason: string }[];
  undelivered: string[];
  defect: (entry: {
    slice?: string;
    unit?: string;
    activity: string;
    trigger: string;
    type?: string;
    impact: string;
    detail: string;
  }) => void;
}): (unit: UnitForClosing, oracle: VerifyOracle) => Promise<boolean> {
  return async (unit, oracle) => {
    const probes = a.sliceProbes.get(unit.slice) ?? [];
    const closed = await close({
      subject: unit.id,
      worktree: a.worktree,
      // Its own files, and the checks themselves — the blinding is spent.
      footprint: [...new Set([...unit.footprint, ...probes.map((p) => path.join(a.testerWt, p))])],
      probeSources: readProbes(a.testerWt, probes),
      history: a.st
        .logTail(unit.id)
        .lines.filter((l) => !l.includes("⚙"))
        .slice(-12),
      criteria: (a.sliceVerifs.get(unit.slice) ?? [])
        .map((v) => a.criterionOf(unit.slice, v.ac))
        .filter((c): c is { id: string; text: string } => !!c),
      ...(a.deps.digest ? { digest: a.deps.digest } : {}),
      ...(a.deps.prepare ? { prepare: a.deps.prepare } : {}),
      model: a.deps.model,
      ...(a.deps.workerModel ? { workerModel: a.deps.workerModel } : {}),
      measure: async () => {
        const c = await oracle.confirmGreen();
        const reds = c.result.kind === "results" ? c.result.results.filter((x) => !x.pass).length : 99;
        return { green: c.green, score: reds, evidence: formatVerifyReply(c.result) };
      },
      exec: a.exec,
      boundedExec: a.boundedExec,
      halted: () => a.st.halted,
      log: (l) => a.log(l, unit.id),
      say: (t) => a.st.doing(unit.id, t),
      onRuling: (r) => a.rulings.push(r),
      defect: (e) => a.defect({ slice: unit.slice, unit: unit.id, ...e }),
      ...(a.deps.worker ? { worker: a.deps.worker } : {}),
    });
    if (!closed.green && closed.report)
      a.undelivered.push(`${unit.id}: ${closed.report.split("\n")[0].slice(0, 300)}`);
    return closed.green;
  };
}
