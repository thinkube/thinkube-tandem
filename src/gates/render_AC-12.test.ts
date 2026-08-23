/**
 * spacePush for a session holding a documentation exemption carries the
 * reason text in the push.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../surfaces/session";
import { spacePush } from "../surfaces/push";

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

test("spacePush carries the reason text when the session holds a documentation exemption", () => {
  const s = bareSession("render-ac12");
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

  const raw = JSON.stringify(spacePush(s));
  assert.ok(
    raw.includes(reason),
    "spacePush must carry the recorded exemption reason in its payload",
  );
});
