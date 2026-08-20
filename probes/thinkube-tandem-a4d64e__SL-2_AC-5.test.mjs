// WHY (INVARIANT): a blank or whitespace-only reason must never excuse
// documentation — this holds forever, so a person cannot silently skip the
// docs obligation by pressing the gesture with nothing typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";
import { emptySpace } from "../out-test/core/schema.js";

const CURRENT = { root: "/repo", head: "h1", dirty: "" };

function bareSession() {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac5-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac5-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    readCurrentStamp: async () => [CURRENT],
  });
}

test("excusing documentation with a blank or whitespace-only reason is refused and records nothing", () => {
  for (const blank of ["", "   ", "\t\n"]) {
    const s = bareSession();
    s.space = {
      ...emptySpace(),
      asks: [{ id: "ask-1", text: "add a tiny internal helper", at: "t" }],
      nodes: [
        {
          id: "n1",
          sentence: "a helper that trims whitespace",
          serves: ["ask-1"],
          needs: [],
          grounding: { touchpoints: [{ path: "src/core/trim.ts" }], stamp: [CURRENT] },
          acceptance: [{ id: "c1", text: "trims leading and trailing space" }],
        },
      ],
    };
    s.cutNodeIds = new Set(["n1"]);

    const r = s.excuseDocs(blank);
    assert.equal(r.ok, false, `a blank reason (${JSON.stringify(blank)}) must be refused`);
    assert.ok(
      typeof r.reason === "string" && r.reason.toLowerCase().includes("reason"),
      "the refusal must say documentation cannot be excused without a reason",
    );
    assert.equal(
      s.space.pendingDocException,
      undefined,
      "a refused gesture must record no pending exemption on the space",
    );
  }
});
