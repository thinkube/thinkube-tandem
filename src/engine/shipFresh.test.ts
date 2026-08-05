/**
 * Unit tests for the ship-freshness check (SP-th4wqe_SL-4 / #21).
 * node:test + node:assert over a real on-disk fixture pair; no vscode, no git.
 * Run via `npm test`.
 *
 * The contract under test (`./shipFresh`, owned by the implementation unit) derives its
 * verdict from the **actual artifact bytes**: it reads the built copy (under `repoRoot`)
 * and the installed copy (under `installedRoot`), sha256-hashes each, and reports `fresh`
 * only when the two hashes are equal. These tests therefore write genuine fixture files —
 * a matching built/installed pair must be `fresh`, and a *mutated* installed copy must be
 * `drift` whose report **names the file**. Because the bytes are hashed here from disk, a
 * green run proves a real content comparison rather than string equality of pre-supplied
 * hashes: the only way `fresh` can hold is identical content on both sides.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  shipFresh,
  describeShipFresh,
  ShipArtifact,
  KANBAN_SERVER_ARTIFACT,
} from "./shipFresh";

/** A fresh temp dir to act as a repo root or an install root. */
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tk-shipfresh-"));
}

/** Write `content` to `root/rel`, creating parent dirs. Returns the absolute path. */
function writeAt(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/**
 * Lay down a built/installed fixture pair for the default kanban artifact. The built copy
 * always gets `built`; the installed copy gets `installed` (default: identical to `built`).
 * Pass a different `installed` to simulate a deploy that didn't land the latest bytes.
 */
function fixturePair(
  built: string,
  installed: string = built,
): { repoRoot: string; installedRoot: string } {
  const repoRoot = tmpDir();
  const installedRoot = tmpDir();
  writeAt(repoRoot, KANBAN_SERVER_ARTIFACT.builtPath, built);
  writeAt(installedRoot, KANBAN_SERVER_ARTIFACT.installedPath, installed);
  return { repoRoot, installedRoot };
}

test("matching built/installed bytes → fresh", async () => {
  const { repoRoot, installedRoot } = fixturePair(
    "export const x = 1; // server bundle v1\n",
  );

  const report = await shipFresh(repoRoot, installedRoot);

  assert.equal(report.fresh, true);
  assert.deepEqual(report.drift, []);
  assert.equal(report.artifacts.length, 1);
  const [a] = report.artifacts;
  assert.equal(a.file, KANBAN_SERVER_ARTIFACT.file);
  assert.equal(a.status, "fresh");
  // Real content hashing: equal-content ⇒ equal, defined hashes (not undefined).
  assert.ok(a.builtHash, "built hash computed from disk");
  assert.equal(a.builtHash, a.installedHash);
  assert.equal(describeShipFresh(report), "fresh");
});

test("a mutated installed artifact → drift naming the file", async () => {
  // Same logical file, but the install lags the build by one byte — a deploy that didn't reach
  // the server. The hashes must differ and the file must be named so the caller knows what to ship.
  const { repoRoot, installedRoot } = fixturePair(
    "export const x = 2; // server bundle v2 (built)\n",
    "export const x = 1; // server bundle v1 (stale install)\n",
  );

  const report = await shipFresh(repoRoot, installedRoot);

  assert.equal(report.fresh, false);
  assert.deepEqual(report.drift, [KANBAN_SERVER_ARTIFACT.file]);
  const [a] = report.artifacts;
  assert.equal(a.status, "drift");
  assert.ok(a.builtHash && a.installedHash, "both sides hashed from disk");
  assert.notEqual(
    a.builtHash,
    a.installedHash,
    "different content ⇒ different hashes (real compare, not string equality)",
  );
  assert.equal(
    describeShipFresh(report),
    `drift: ${KANBAN_SERVER_ARTIFACT.file}`,
  );
});

test("identical strings at different paths are NOT trusted as fresh by label — only by bytes", async () => {
  // Guards against a string-equality shortcut: feed two files whose *content* is identical and
  // confirm fresh; then flip one byte and confirm the same labels now drift. The verdict tracks
  // bytes on disk, not the artifact descriptor.
  const same = "identical-bytes\n";
  const fresh = fixturePair(same);
  assert.equal(
    (await shipFresh(fresh.repoRoot, fresh.installedRoot)).fresh,
    true,
  );

  const drifted = fixturePair(same, same + "x");
  const r = await shipFresh(drifted.repoRoot, drifted.installedRoot);
  assert.equal(r.fresh, false);
  assert.deepEqual(r.drift, [KANBAN_SERVER_ARTIFACT.file]);
});

test("missing installed artifact (deploy never landed) → drift naming the file", async () => {
  const repoRoot = tmpDir();
  const installedRoot = tmpDir(); // empty: nothing was ever deployed here
  writeAt(
    repoRoot,
    KANBAN_SERVER_ARTIFACT.builtPath,
    "built but never shipped\n",
  );

  const report = await shipFresh(repoRoot, installedRoot);

  assert.equal(report.fresh, false);
  assert.deepEqual(report.drift, [KANBAN_SERVER_ARTIFACT.file]);
  const [a] = report.artifacts;
  assert.equal(a.status, "missing-installed");
  assert.ok(a.builtHash, "built side hashed");
  assert.equal(a.installedHash, undefined, "installed side absent ⇒ no hash");
});

test("missing built artifact (nothing compiled) → drift, cannot be fresh", async () => {
  const repoRoot = tmpDir(); // empty: nothing was built
  const installedRoot = tmpDir();
  writeAt(
    installedRoot,
    KANBAN_SERVER_ARTIFACT.installedPath,
    "stale install\n",
  );

  const report = await shipFresh(repoRoot, installedRoot);

  assert.equal(report.fresh, false);
  assert.deepEqual(report.drift, [KANBAN_SERVER_ARTIFACT.file]);
  assert.equal(report.artifacts[0].status, "missing-built");
  assert.equal(report.artifacts[0].builtHash, undefined);
});

test("multiple artifacts: one drifts → fresh is false and only the drifted file is named", async () => {
  const repoRoot = tmpDir();
  const installedRoot = tmpDir();
  const ok: ShipArtifact = {
    file: "mcp/kanban.js",
    builtPath: "dist/mcp/kanban.js",
    installedPath: "mcp/kanban.js",
  };
  const bad: ShipArtifact = {
    file: "mcp/other.js",
    builtPath: "dist/mcp/other.js",
    installedPath: "mcp/other.js",
  };
  writeAt(repoRoot, ok.builtPath, "A\n");
  writeAt(installedRoot, ok.installedPath, "A\n"); // matches → fresh
  writeAt(repoRoot, bad.builtPath, "B-new\n");
  writeAt(installedRoot, bad.installedPath, "B-old\n"); // mismatch → drift

  const report = await shipFresh(repoRoot, installedRoot, [ok, bad]);

  assert.equal(report.fresh, false);
  assert.deepEqual(report.drift, ["mcp/other.js"]);
  assert.equal(report.artifacts.length, 2);
  assert.equal(report.artifacts[0].status, "fresh");
  assert.equal(report.artifacts[1].status, "drift");
});
