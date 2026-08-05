/**
 * Unit tests for the held-out probe oracle store (2026-07-14).
 * node:test + node:assert; run via `npm test`.
 *
 * The store exists because `role: test` units author their probes as UNTRACKED
 * files in the tester worktree and `createTester` re-snapshots that tree with
 * `reset --hard` + `clean -fd` on every run — without durable persistence, a
 * rework re-run wiped the probes while `units_done` still said their unit was
 * done, and the closing gate ENOENT'd copying ghosts. These tests pin the store's
 * contract: persist-before-done (a missing source THROWS), contract-hash keying
 * (a re-signed spec voids the old oracle), restore round-trip, and best-effort
 * removal for implicated (`last_fault: test`) units.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  oracleStoreDir,
  persistProbes,
  probesPresent,
  removeProbes,
  restoreProbes,
} from "./oracleStore";

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "oracle-store-"));
}

/** Author a fake probe file under `root` at `rel`. */
async function author(root: string, rel: string, body: string): Promise<void> {
  const p = path.join(root, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body);
}

const P1 = "src/acceptance/SP-9_1_AC-1.test.ts";
const P2 = "src/acceptance/SP-9_1_AC-2.test.ts";

test("oracleStoreDir places the store under the worktrees root, per spec", () => {
  // WHY (INVARIANT): the store must live OUTSIDE every worktree and branch — a
  // path inside the code/tester worktree would be wiped by the very resets it
  // exists to survive (and would leak probes to code workers, breaking blinding).
  const dir = oracleStoreDir("/repos/my-ext", "21/1");
  assert.equal(dir, "/repos/my-ext-worktrees/oracle-store/TEP-21_SP-1");
  const withBase = oracleStoreDir("/repos/my-ext", "21/1", "/elsewhere");
  assert.equal(withBase, "/elsewhere/oracle-store/TEP-21_SP-1");
});

test("persist → present → restore round-trips probe bytes (nested rel paths)", async () => {
  // WHY (INVARIANT): the store's whole job — probes persisted at checkpoint come
  // back byte-identical into a freshly wiped tester on the next run.
  const store = await tmpdir();
  const tester = await tmpdir();
  const fresh = await tmpdir();
  await author(tester, P1, "probe one");
  await author(tester, P2, "probe two");

  await persistProbes(store, tester, [P1, P2], "hash-a");
  assert.ok(await probesPresent(store, [P1, P2], "hash-a"));

  const restored = await restoreProbes(store, fresh, "hash-a");
  assert.deepEqual(restored.sort(), [P1, P2].sort());
  assert.equal(await fs.readFile(path.join(fresh, P1), "utf8"), "probe one");
  assert.equal(await fs.readFile(path.join(fresh, P2), "utf8"), "probe two");
});

test("persist THROWS when a declared probe file is missing (persist-before-done)", async () => {
  // WHY (INVARIANT): the caller records `units_done` only after a successful
  // persist. If a declared footprint file was never authored, persisting must
  // fail loudly so the unit is NOT marked done — otherwise the done-flag lie
  // (recorded done, nothing persisted) this store removes would come straight back.
  const store = await tmpdir();
  const tester = await tmpdir();
  await author(tester, P1, "only one exists");
  await assert.rejects(() => persistProbes(store, tester, [P1, P2], "hash-a"));
  // The authored half may have landed, but presence of the FULL set is false.
  assert.equal(await probesPresent(store, [P1, P2], "hash-a"), false);
});

test("a changed contract hash voids the oracle: present=false, restore=[]", async () => {
  // WHY (INVARIANT): probes are written against a signed AC contract
  // (`ac_verifications_hash`); after a re-sign the old probes may grade criteria
  // that no longer exist. They must be treated as absent so their units re-author.
  const store = await tmpdir();
  const tester = await tmpdir();
  const fresh = await tmpdir();
  await author(tester, P1, "old contract probe");
  await persistProbes(store, tester, [P1], "hash-a");

  assert.equal(await probesPresent(store, [P1], "hash-b"), false);
  assert.deepEqual(await restoreProbes(store, fresh, "hash-b"), []);
  // The matching hash still works.
  assert.ok(await probesPresent(store, [P1], "hash-a"));
});

test("persisting under a new hash wipes the stale-contract content first", async () => {
  // WHY (INVARIANT): after a re-sign, freshly authored probes replace the WHOLE
  // store — a leftover stale probe restored beside new ones would grade a dead
  // contract.
  const store = await tmpdir();
  const tester = await tmpdir();
  await author(tester, P1, "old");
  await persistProbes(store, tester, [P1], "hash-a");
  await author(tester, P2, "new");
  await persistProbes(store, tester, [P2], "hash-b");

  assert.equal(await probesPresent(store, [P1], "hash-b"), false); // stale gone
  assert.ok(await probesPresent(store, [P2], "hash-b"));
});

test("hash tolerance: either side missing a hash passes (unsigned specs stay usable)", async () => {
  // WHY: legacy/unsigned specs have no `ac_verifications_hash`; refusing them
  // would loop their test units through re-author forever. Either-side-missing
  // is accepted and only a REAL mismatch voids the store.
  const store = await tmpdir();
  const tester = await tmpdir();
  await author(tester, P1, "unsigned era");
  await persistProbes(store, tester, [P1]); // no hash
  assert.ok(await probesPresent(store, [P1], "hash-later")); // spec signed later
  assert.ok(await probesPresent(store, [P1])); // still unsigned
});

test("removeProbes drops an implicated unit's probes; missing targets are a no-op", async () => {
  // WHY (INVARIANT): a `last_fault: test` rework re-authors its probes from a
  // clean oracle — the stale ones must not be restorable. Removal is best-effort:
  // an already-absent entry never breaks the scheduling pass.
  const store = await tmpdir();
  const tester = await tmpdir();
  await author(tester, P1, "will be dropped");
  await persistProbes(store, tester, [P1], "hash-a");

  await removeProbes(store, [P1]);
  assert.equal(await probesPresent(store, [P1], "hash-a"), false);
  await removeProbes(store, [P1, "never/existed.test.ts"]); // no throw
});

test("restore is committed-wins: an existing (branch-committed) file is never overwritten by the store", async () => {
  // WHY (INVARIANT): an /attend or auto-attend probe fix lands on the BRANCH, so it
  // exists in the fresh tester snapshot. The store's older copy must not clobber it —
  // that shadowing is exactly what kept TEP-21_SP-1_SL-3 red while its fix sat
  // committed. The store only fills in files the reset actually wiped.
  const store = await tmpdir();
  const tester = await tmpdir();
  const fresh = await tmpdir();
  await author(tester, P1, "stale store copy");
  await author(tester, P2, "only-in-store probe");
  await persistProbes(store, tester, [P1, P2], "hash-a");

  await author(fresh, P1, "FIXED on the branch"); // committed → present in the snapshot
  const restored = await restoreProbes(store, fresh, "hash-a");

  assert.deepEqual(restored, [P2], "only the wiped (absent) probe is restored");
  assert.equal(
    await fs.readFile(path.join(fresh, P1), "utf8"),
    "FIXED on the branch",
    "the committed fix survives the restore",
  );
  assert.equal(
    await fs.readFile(path.join(fresh, P2), "utf8"),
    "only-in-store probe",
    "the wiped probe comes back from the store",
  );
});

test("empty footprint is vacuously present; absent store restores nothing", async () => {
  // WHY: a test unit with no declared probe files has nothing to persist or
  // lose — treating it as absent would re-author it forever. And restoring from
  // a store that was never written must be a clean no-op, not an error.
  const store = await tmpdir();
  const fresh = await tmpdir();
  assert.ok(await probesPresent(store, []));
  assert.deepEqual(await restoreProbes(store, fresh), []);
  assert.equal(await probesPresent(store, [P1]), false);
});
