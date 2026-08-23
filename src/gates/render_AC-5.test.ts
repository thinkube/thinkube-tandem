/**
 * The same gesture refuses a blank or whitespace-only reason, returns a
 * reason saying documentation cannot be excused without one, and records
 * nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../surfaces/session";

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

function withOneNode(s: TandemSession): void {
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
}

test("excuseDocs refuses a blank or whitespace-only reason, says why, and records nothing", () => {
  for (const blank of ["", "   ", "\t\n"]) {
    const s = bareSession("render-ac5");
    withOneNode(s);

    const r = s.excuseDocs(blank);
    assert.equal(r.ok, false, `a blank reason (${JSON.stringify(blank)}) must be refused`);
    assert.match(
      r.reason ?? "",
      /documentation cannot be excused without/i,
      "the refusal must say documentation cannot be excused without a reason",
    );

    const page = s.cutScreen();
    assert.match(
      page,
      /documentation is missing/i,
      "nothing was recorded — the review page must still say documentation is missing",
    );
  }
});
