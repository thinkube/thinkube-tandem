/**
 * The dispatch approval's content hash: a documentation exemption must
 * ride the bare cut tepContentHash rebuilds, so the inner signCut it calls
 * is not refused for missing documentation — and editing that reason after
 * signing re-arms the gate, the same as editing any other grounded input.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { emptySpace, Space } from "../core/schema";
import { tepContentHash } from "./approval";
import { signCut } from "./sign";
import { TandemSession } from "../surfaces/session";

function makeSpace(): { space: Space; changeId: string } {
  const s: Space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "ship a change with no documentation", at: "t" }],
    nodes: [
      {
        id: "node-1",
        sentence: "a change that lands only in code",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "it works" }],
        grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
      },
    ],
  };
  return { space: s, changeId: "node-1" };
}

test("tepContentHash carries the exemption into the rebuilt cut, so an excused cut still hashes a non-empty grounding half", () => {
  const { space, changeId } = makeSpace();
  const cut = {
    id: "cut-1",
    tepId: "TEP-user-1",
    changeIds: [changeId],
    exemption: { reason: "config-only change; nothing to document" },
  };
  const hash = tepContentHash(space, cut);
  assert.ok(hash, "a hash is produced");

  const bareNoExemption = { id: "cut-2", tepId: "TEP-user-1", changeIds: [changeId] };
  const refusedHash = tepContentHash(space, bareNoExemption);
  assert.notEqual(
    hash,
    refusedHash,
    "the excused cut must not hash the same as a cut whose inner sign was refused for missing documentation",
  );

  const signed = signCut(space, { id: "pair", changeIds: [changeId], exemption: cut.exemption }, "t", "x");
  assert.ok(signed.ok, "the exemption lets the inner sign through, so the grounding half is non-empty");
});

function makeDeps() {
  return {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-approval-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-approval-keys-")),
    name: async () => [],
    now: () => "2026-08-20T09:00:00Z",
    readCurrentStamp: async () => [],
    knowledge: async () => ({
      repoRoot: "/repo",
      graph: { graphPath: "/graph.json", stamp: { root: "/repo", head: "h", dirty: "" } },
      map: "",
      digest: "",
      provision: "", prepare: "", runOne: "", suiteReds: [], rememberSuiteReds: () => {},
      resetup: async () => ({ provision: "", prepare: "", runOne: "" }), proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
    classify: async () => "ask" as const,
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    ground: async () => ({ changes: [], questions: [] }),
  };
}

test("editing the exemption reason on a signed cut changes tepContentHash and un-approves dispatch", () => {
  const session = new TandemSession(makeDeps() as unknown as ConstructorParameters<typeof TandemSession>[0]);
  session.space = {
    ...session.space,
    asks: [{ id: "ask-1", text: "ship a change with no documentation", at: "t" }],
    nodes: [
      {
        id: "node-1",
        sentence: "a change that lands only in code",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "it works" }],
        grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
      },
    ],
    pendingDocException: { reason: "config-only change; nothing to document" },
  };
  session.cutNodeIds = new Set(["node-1"]);

  const r = session.signCut();
  assert.ok(r.ok, r.ok ? "" : r.reason);
  const tepId = session.space.cuts[0].tepId!;

  const before = session.tepApproval(tepId);
  assert.equal(before.approved, true, "the freshly minted token matches the just-signed cut");

  session.space = {
    ...session.space,
    cuts: session.space.cuts.map((c) =>
      c.tepId === tepId
        ? { ...c, exemption: { ...c.exemption, reason: "a different reason, typed after signing" } }
        : c,
    ),
  };

  const after = session.tepApproval(tepId);
  assert.equal(after.approved, false, "the stale token no longer matches");
  assert.equal(after.reason, "content-mismatch");
});
