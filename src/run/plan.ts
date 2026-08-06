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
