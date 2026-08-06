/**
 * Author-time plan hardening at dispatch: the test-impact blast radius.
 * An existing test that statically imports a changed source file is inside
 * the change — unit tests fold into the slice's code footprint
 * automatically; a held-out probe there is a refusal (never an
 * implementer's file). Returns the refusal text, or null when the plan
 * stands (possibly with folded footprints).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SliceForDag } from "../engine/core/dag";
import {
  buildTestImpactRefusal,
  findUncoveredTests,
} from "../engine/testImpactFootprint";
import type { Exec } from "./oracle";
import * as fsp from "node:fs/promises";

export async function foldBlastRadius(
  slices: SliceForDag[],
  repoRoot: string,
  exec: Exec,
  log: (line: string) => void,
): Promise<string | null> {
  const tracked = (await exec("git", ["-C", repoRoot, "ls-files"], repoRoot)).out
    .split("\n")
    .filter((p) => /\.(test|spec|host)\.[a-z]+$|(^|\/)probes\/|(^|\/)acceptance\//.test(p));
  const repoFiles = [];
  for (const rel of tracked) {
    try {
      repoFiles.push({
        path: rel,
        content: await fs.readFile(path.join(repoRoot, rel), "utf8"),
      });
    } catch {
      /* unreadable tracked file — outside the blast scan */
    }
  }
  for (const s of slices) {
    const allFootprints = s.workUnits.flatMap((u) => u.footprint);
    const violations = findUncoveredTests({
      changedFiles: s.files ?? [],
      footprintPaths: allFootprints,
      repoFiles,
    });
    const heldOut = violations.filter((v) => v.kind === "held-out");
    if (heldOut.length) return buildTestImpactRefusal(heldOut);
    const folded = violations.filter((v) => v.kind === "unit").map((v) => v.test);
    if (folded.length) {
      const codeUnit = s.workUnits.find((u) => (u.role ?? "code") === "code");
      if (codeUnit) codeUnit.footprint.push(...folded);
      log(`${s.handle}: blast radius folded ${folded.join(", ")} into the code footprint`);
    }
  }
  return null;
}

/**
 * Execution locks (§multi-user commitment 4): a machine-local lock file per
 * in-flight run on a repository. A new dispatch whose footprints intersect
 * an in-flight run's — including a DIFFERENT project's in the same
 * monorepo — refuses with the collision named. Best-effort bookkeeping; the
 * forge branch claim stays the hard mutex.
 */
export async function claimRunLock(
  wtRoot: string,
  wtName: string,
  runName: string,
  slices: SliceForDag[],
): Promise<{ refusal?: string; unlock: () => Promise<void> }> {
  const locksDir = path.join(wtRoot, "locks");
  const myFootprints = slices.flatMap((s) => [
    ...(s.files ?? []),
    ...s.workUnits.flatMap((u) => u.footprint),
  ]);
  const lockFile = path.join(locksDir, `${wtName}.json`);
  const unlock = async (): Promise<void> => {
    await fsp.rm(lockFile, { force: true }).catch(() => {});
  };
  try {
    await fsp.mkdir(locksDir, { recursive: true });
    for (const f of await fsp.readdir(locksDir)) {
      if (!f.endsWith(".json") || f === `${wtName}.json`) continue;
      try {
        const other = JSON.parse(await fsp.readFile(path.join(locksDir, f), "utf8")) as {
          runName?: string;
          footprints?: string[];
        };
        const overlap = (other.footprints ?? []).filter((p) =>
          myFootprints.some((m) => m === p || m.startsWith(p + "/") || p.startsWith(m + "/")),
        );
        if (overlap.length)
          return {
            refusal: `dispatch refused: footprints collide with in-flight run ${other.runName ?? f} on this repository (${[...new Set(overlap)].slice(0, 5).join(", ")}) — accept or stop that run first`,
            unlock: async () => {},
          };
      } catch {
        /* an unreadable lock never blocks — the branch claim still guards */
      }
    }
    await fsp.writeFile(lockFile, JSON.stringify({ runName, footprints: myFootprints }));
  } catch {
    /* lock bookkeeping is best-effort; the branch claim is the hard mutex */
  }
  return { unlock };
}
