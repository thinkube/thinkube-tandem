/**
 * Ship-freshness check — catch a deploy that didn't reach the server
 *.
 *
 * The kanban MCP server ships as a single bundled artifact: `npm run compile`
 * (via `esbuild.mcp.mjs`) writes `dist/mcp/kanban.js` in this repo, and `deploy`
 * copies that file into the installed tandem-methodology plugin's `mcp/kanban.js`.
 * That copy is a **hand-copied build artifact with no sync script** (see the
 * "Methodology bundle source-of-truth" memory): nothing guarantees a build that
 * succeeded in the repo actually reached the installed server. A stale install is
 * silent — the panel keeps talking to last week's server.
 *
 * `shipFresh` closes that gap by deriving its verdict from the **actual artifact
 * bytes**: it reads the built file and the installed file, hashes each, and
 * reports `fresh` only when the content hashes are equal. A mismatch (or a missing
 * built/installed file) is `drift`, and the report names the artifact that drifted
 * so a caller can say exactly which file to re-deploy.
 *
 * This is a real content comparison, not a trust-the-caller string compare: the
 * hashes are computed here from the bytes on disk, so equal-hash ⇒ identical
 * content and the check cannot be fooled by passing two matching strings.
 *
 * Pure-ish and transport-free: it touches only the filesystem (read-only) and
 * `crypto`. No `git`, no `gh`, no VS Code API — so it is unit-testable over a
 * fixture pair of directories.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * One built-vs-installed artifact to compare. The built copy lives under
 * `repoRoot` at {@link builtPath}; the installed copy lives under `installedRoot`
 * at {@link installedPath} (the two relative paths differ — the repo nests the
 * bundle under `dist/`, the install does not). {@link file} is the human label
 * used in drift reports.
 */
export interface ShipArtifact {
  /** Label naming the artifact in `fresh`/`drift` reports (e.g. `mcp/kanban.js`). */
  file: string;
  /** Path of the **built** artifact, relative to `repoRoot`. */
  builtPath: string;
  /** Path of the **installed** artifact, relative to `installedRoot`. */
  installedPath: string;
}

/**
 * The kanban MCP server bundle — the default artifact `shipFresh` checks. Built to
 * `dist/mcp/kanban.js` by `esbuild.mcp.mjs`; deployed (hand-copied) into the
 * plugin's `mcp/kanban.js`.
 */
export const KANBAN_SERVER_ARTIFACT: ShipArtifact = {
  file: "mcp/kanban.js",
  builtPath: "dist/mcp/kanban.js",
  installedPath: "mcp/kanban.js",
};

/** Why a single artifact is not fresh (or that it is). */
export type ArtifactStatus =
  | "fresh"
  | "drift"
  | "missing-built"
  | "missing-installed";

/** The built-vs-installed comparison for one artifact. */
export interface ArtifactComparison {
  /** The artifact's {@link ShipArtifact.file} label. */
  file: string;
  /** Outcome of comparing the built and installed bytes. */
  status: ArtifactStatus;
  /** Content hash of the built artifact (`undefined` if it was missing). */
  builtHash?: string;
  /** Content hash of the installed artifact (`undefined` if it was missing). */
  installedHash?: string;
}

/** The overall ship-freshness verdict across every checked artifact. */
export interface ShipFreshReport {
  /** `true` iff **every** artifact's built and installed bytes are identical. */
  fresh: boolean;
  /** Per-artifact comparisons, in the order the artifacts were given. */
  artifacts: ArtifactComparison[];
  /** The `file` labels that drifted (or were missing) — empty when `fresh`. */
  drift: string[];
}

/** sha256 of a file's bytes, or `undefined` if the file does not exist. */
async function hashFile(absPath: string): Promise<string | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  return createHash("sha256").update(bytes).digest("hex");
}

/** Compare one artifact's built bytes against its installed bytes. */
async function compareArtifact(
  repoRoot: string,
  installedRoot: string,
  artifact: ShipArtifact,
): Promise<ArtifactComparison> {
  const [builtHash, installedHash] = await Promise.all([
    hashFile(path.join(repoRoot, artifact.builtPath)),
    hashFile(path.join(installedRoot, artifact.installedPath)),
  ]);

  let status: ArtifactStatus;
  if (builtHash === undefined) {
    // Nothing was built — can't possibly be a fresh deploy.
    status = "missing-built";
  } else if (installedHash === undefined) {
    // Built but never reached the install location.
    status = "missing-installed";
  } else if (builtHash === installedHash) {
    status = "fresh";
  } else {
    status = "drift";
  }

  return { file: artifact.file, status, builtHash, installedHash };
}

/**
 * Hash the built vs installed server artifact(s) and report ship-freshness.
 *
 * Reads each artifact's built copy (under `repoRoot`) and installed copy (under
 * `installedRoot`), hashes the bytes, and compares. The result is `fresh` only
 * when every artifact's two hashes match; otherwise it is drift and
 * {@link ShipFreshReport.drift} names the offending `file`(s) — including any
 * artifact missing on either side.
 *
 * @param repoRoot       Repo root containing the freshly built artifact(s).
 * @param installedRoot  Install root (e.g. the deployed plugin dir).
 * @param artifacts      Artifacts to check; defaults to the kanban server bundle.
 */
export async function shipFresh(
  repoRoot: string,
  installedRoot: string,
  artifacts: ShipArtifact[] = [KANBAN_SERVER_ARTIFACT],
): Promise<ShipFreshReport> {
  const comparisons = await Promise.all(
    artifacts.map((a) => compareArtifact(repoRoot, installedRoot, a)),
  );
  const drift = comparisons
    .filter((c) => c.status !== "fresh")
    .map((c) => c.file);
  return { fresh: drift.length === 0, artifacts: comparisons, drift };
}

/**
 * One-line, human-readable summary of a {@link ShipFreshReport} — `"fresh"` when
 * everything matches, otherwise `"drift: <file>, <file>"` naming what to re-deploy.
 */
export function describeShipFresh(report: ShipFreshReport): string {
  return report.fresh ? "fresh" : `drift: ${report.drift.join(", ")}`;
}
