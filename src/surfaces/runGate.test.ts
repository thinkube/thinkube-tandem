/**
 * signCutGesture spends the session's pending documentation exemption on
 * the one cut it excuses: once that cut is signed, the exemption must not
 * silently carry over and excuse whatever cut comes next.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";

function bareSession(): TandemSession {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-rungate-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-rungate-keys-")),
    now: () => "2026-08-22T00:00:00.000Z",
    author: "t",
    readCurrentStamp: async () => [],
    knowledge: async () => ({
      repoRoot: "/repo",
      graph: { graphPath: "/g.json", stamp: { root: "/repo", head: "h", dirty: "" } },
      map: "",
      digest: "",
      provision: "",
      prepare: "",
      resetup: async () => ({ provision: "", prepare: "", runOne: "" }),
      proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
  } as unknown as ConstructorParameters<typeof TandemSession>[0]);
}

test("after the session signs a cut carrying an exemption, the session holds no exemption for the next cut", () => {
  const s = bareSession();
  s.space = {
    ...s.space,
    nodes: [
      {
        id: "n1",
        sentence: "the widget resizes",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "c1", text: "it resizes", kind: "probe" }],
      },
    ],
  } as never;
  s.cutNodeIds = new Set(["n1"]);
  const excused = s.excuseDocs("internal-only change; nothing for a reader to consult");
  assert.equal(excused.ok, true);
  const signed = s.signCut();
  assert.equal(signed.ok, true, "the cut carrying the exemption must be signable");

  assert.ok(
    !s.space.pendingDocsExemption,
    "the session must hold no pending documentation exemption once its cut is signed",
  );
});
