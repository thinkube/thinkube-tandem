/**
 * The sign gesture: the space's pending documentation exemption rides onto
 * the cut it signs, then is spent — the next cut starts with none of its
 * own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TandemSession } from "./session";

function makeDeps() {
  return {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-rungate-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-rungate-keys-")),
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

test("after signing a cut carrying an exemption, the session holds no exemption for the next cut", () => {
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
  assert.ok(session.space.cuts[0].exemption, "the exemption rode onto the signed cut");
  assert.equal(
    session.space.pendingDocException,
    undefined,
    "the session holds no exemption once it has been spent on the signed cut",
  );
});
