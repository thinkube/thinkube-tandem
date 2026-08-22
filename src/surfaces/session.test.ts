/**
 * Every session is built carrying the display name of its own thinking
 * space, distinct from the repository or project label that names its
 * owner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SessionDeps, TandemSession } from "./session";

function sessionWith(spaceName: string, scopeLabel: string): TandemSession {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    spaceName,
    scope: { gitRoot: "/repo", prefix: "", projectId: "p1", label: scopeLabel },
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
  } as unknown as SessionDeps);
}

test("a session carries the display name of its own thinking space, taken from the space listing rather than the repository or project label", () => {
  const session = sessionWith("Rebrand the checkout flow", "checkout-service");

  // The criterion is that the session is BUILT CARRYING the space's display
  // name as SessionDeps.spaceName — read back here off the session's own
  // public deps, the surface the criterion names.
  assert.equal(
    session.deps.spaceName,
    "Rebrand the checkout flow",
    "the session's space name is the display name handed in as SessionDeps.spaceName",
  );
  assert.notEqual(
    session.deps.spaceName,
    session.repoName,
    "the space's display name is never the repository/project label — they are two different names read from two different places",
  );
  assert.equal(
    session.repoName,
    "checkout-service",
    "the repository/project label is still read from the scope, unchanged and independent",
  );
});

const CURRENT = { root: "/repo", head: "h1", dirty: "" };

function docsSession(): TandemSession {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-docs-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-docs-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    readCurrentStamp: async () => [CURRENT],
  } as unknown as SessionDeps);
}

test("the session gesture that excuses documentation records the reason and the cut review carries it", () => {
  const s = docsSession();
  s.space = {
    ...s.space,
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

  const reason = "internal-only change, nothing to document for users";
  const r = s.excuseDocs(reason);
  assert.ok(r.ok, `excusing documentation with a real reason must succeed: ${r.reason ?? ""}`);

  const screen = s.cutScreen();
  assert.ok(
    screen.includes(reason),
    "the cut review rendered after excusing documentation carries the recorded reason",
  );
});

test("excusing documentation with a blank or whitespace-only reason is refused and records nothing", () => {
  for (const blank of ["", "   ", "\t\n"]) {
    const s = docsSession();
    s.space = {
      ...s.space,
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
      "the refusal says documentation cannot be excused without a reason",
    );
    assert.equal(
      s.space.pendingDocException,
      undefined,
      "a refused gesture records no pending exemption on the space",
    );
  }
});
