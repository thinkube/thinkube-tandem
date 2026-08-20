// WHY (TRANSITION): buttons.test.ts's TABLE must be brought under the new
// control — an unlisted control is silently ungated. This proves the
// rendered surface's documentation-exemption control is on exactly in the
// phases the button table lists for it, checked against the built webview
// bundle the same way every other control is checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { TandemSession } from "../out-test/surfaces/session.js";
import { spacePush } from "../out-test/surfaces/panel.js";
import { phaseOf } from "../out-test/surfaces/phase.js";
import { emptySpace } from "../out-test/core/schema.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WEBVIEW = path.join(ROOT, "webview", "map");

const CURRENT = { root: "/repo", head: "h2", dirty: "" };

function bareSession() {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac11-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac11-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    readCurrentStamp: async () => [CURRENT],
  });
}

function understoodSpace() {
  return {
    ...emptySpace(),
    draft: "and the log stays readable",
    asks: [{ id: "ask-1", text: "the panel follows the run", at: "t" }],
    subjects: [{ id: "sub-1", name: "the panel", from: ["ask-1"] }],
    claims: [{ id: "cl-1", subjectId: "sub-1", text: "it follows", fromAsk: "ask-1" }],
    nodes: [
      {
        id: "n1",
        sentence: "the panel scrolls with the running step",
        serves: ["ask-1"],
        servesClaim: "cl-1",
        needs: [],
        grounding: { touchpoints: [{ path: "src/panel.ts" }], stamp: [CURRENT] },
        acceptance: [{ id: "c1", text: "opening the panel shows the live step", kind: "probe" }],
      },
    ],
  };
}

// One session fixture per phase, minimal but sufficient for phaseOf() to
// classify it correctly — mirrors src/surfaces/phaseFixtures.ts's shapes
// without depending on that non-contract helper module.
function sessionInPhase(phase) {
  const s = bareSession();
  switch (phase) {
    case "drafting":
      s.space = { ...emptySpace(), draft: "the panel follows the run" };
      break;
    case "read":
      s.space = {
        ...emptySpace(),
        draft: "the panel follows the run",
        proposal: {
          askIds: ["ask-1"],
          texts: ["the panel follows the run"],
          subjects: [{ name: "the panel", from: [1], claims: [{ text: "it follows", from: 1 }] }],
          missing: [],
        },
      };
      break;
    case "understood":
      s.space = understoodSpace();
      break;
    case "signed":
      s.space = {
        ...understoodSpace(),
        cuts: [{ id: "cut-1", changeIds: ["n1"], tepId: "TEP-1", signature: { at: "t", renderHash: "r", groundingHash: "g" } }],
      };
      break;
    case "running":
      s.space = {
        ...understoodSpace(),
        cuts: [{ id: "cut-1", changeIds: ["n1"], tepId: "TEP-1", signature: { at: "t", renderHash: "r", groundingHash: "g" } }],
      };
      s.running = true;
      break;
    case "delivered":
      s.space = {
        ...understoodSpace(),
        cuts: [{ id: "cut-1", changeIds: ["n1"], tepId: "TEP-1", signature: { at: "t", renderHash: "r", groundingHash: "g" } }],
        deliveries: [
          {
            id: "delivery-TEP-1",
            cutId: "cut-1",
            branch: "tandem/TEP-1",
            proofs: [{ kind: "probe", label: "opening the panel shows the live step", verdict: "green", criterionId: "c1" }],
          },
        ],
      };
      break;
  }
  return s;
}

const PHASES = ["drafting", "read", "understood", "signed", "running", "delivered"];

// The button table's own copy of when "excuse-docs" is on, mirroring
// src/surfaces/buttons.test.ts's TABLE entry for this control.
const EXCUSE_DOCS_PHASES = new Set(["understood"]);

test("the documentation-exemption control is on exactly in the phases the button table lists for it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-buttons-ac11-"));
  const pushes = {};
  for (const p of PHASES) {
    const s = sessionInPhase(p);
    assert.equal(phaseOf(s), p, `the fixture for ${p} is in that phase`);
    pushes[p] = spacePush(s);
  }
  const pushFile = path.join(dir, "pushes.json");
  fs.writeFileSync(pushFile, JSON.stringify(pushes));
  const bundle = path.join(ROOT, "out-test", "harness", "buttons.cjs");
  execFileSync("npm", ["run", "-s", "buttons"], { cwd: WEBVIEW, stdio: "pipe" });
  const seen = JSON.parse(
    execFileSync(process.execPath, [bundle, pushFile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const problems = [];
  for (const phase of PHASES) {
    let found = false;
    for (const [page, buttons] of Object.entries(seen[phase])) {
      for (const b of buttons) {
        const on = b.startsWith("on");
        const name = b.slice(4).split(/[ =]/)[0];
        if (name !== "excuse-docs") continue;
        found = true;
        const should = EXCUSE_DOCS_PHASES.has(phase);
        if (on !== should)
          problems.push(`${phase} · ${page} · excuse-docs: is ${on ? "on" : "off"}, must be ${should ? "on" : "off"}`);
      }
    }
    if (!found && EXCUSE_DOCS_PHASES.has(phase))
      problems.push(`${phase}: excuse-docs is not on any page, but the table says it should be on`);
  }
  assert.deepEqual(problems, [], "documentation-exemption control gating:\n" + problems.join("\n"));
});
