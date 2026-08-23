/**
 * After the session signs a cut carrying an exemption, the session holds no
 * exemption for the next cut — it is spent by the signature it fed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../surfaces/session";
import { signCutGesture } from "../surfaces/runGate";

function bareSession(tag: string): TandemSession {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-${tag}-`)),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-${tag}-keys-`)),
    now: () => "2026-08-18T10:00:00Z",
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

test("the pending exemption is spent by the signature it fed", () => {
  const s = bareSession("sign-ac3");
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

  const reason = "internal-only change, nothing to document";
  assert.equal(s.excuseDocs(reason).ok, true);
  assert.ok(s.space.pendingDocsExemption, "the exemption is held before signing");

  signCutGesture(s);

  assert.equal(
    s.space.pendingDocsExemption,
    undefined,
    "once signed, the session must hold no exemption for the next cut",
  );
});
