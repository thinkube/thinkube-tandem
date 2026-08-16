/**
 * The claim card answers "what is verified about this?" from the state,
 * not from the iteration history: each check carries its newest verdict,
 * where its standing proof lives, and whether the world moved since —
 * proved-then is never silently shown as proved-now.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { spacePush } from "./panel";
import { emptySpace } from "../core/schema";

const CURRENT = { root: "/repo", head: "h2", dirty: "" };

function sessionWithVerifiedWork(): TandemSession {
  const s = new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "2026-08-12T20:00:00Z",
    author: "t",
    classify: async () => "ask" as const,
    readCurrentStamp: async () => [CURRENT],
    knowledge: async () => ({
      repoRoot: "/repo",
      graph: { graphPath: "/g.json", stamp: CURRENT },
      map: "",
      digest: "",
      provision: "", prepare: "", resetup: async () => ({ provision: "", prepare: "" }), proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
  } as unknown as ConstructorParameters<typeof TandemSession>[0]);
  s.space = {
    ...emptySpace(),
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
        // Grounding is CURRENT — the promise itself has not gone stale.
        grounding: { touchpoints: [{ path: "src/panel.ts" }], stamp: [CURRENT] },
        acceptance: [
          {
            id: "c1",
            text: "opening the panel shows the live step",
            // Bound at h1; the repo is at h2 — the proof has drifted.
            proof: { path: "src/panel.test.ts", test: "panel follows the run", stamp: [{ root: "/repo", head: "h1", dirty: "" }] },
          },
          { id: "c2", text: "the docs page says the panel follows", kind: "assessment" },
        ],
      },
    ],
    cuts: [
      {
        id: "cut-1",
        changeIds: ["n1"],
        tepId: "TEP-9",
        signature: { at: "2026-08-12T18:00:00Z", renderHash: "r", groundingHash: "g" },
      },
    ],
    deliveries: [
      {
        id: "d1",
        cutId: "cut-1",
        branch: "tandem/TEP-9",
        acceptedAt: "2026-08-12T19:00:00Z",
        proofs: [
          { kind: "probe", label: "check 1", verdict: "green", criterionId: "c1" },
          { kind: "assessment", label: "review-1", verdict: "green", criterionId: "c2" },
        ],
      },
    ],
  };
  return s;
}

test("a claim card reads verification from state: verdict, proof address, drift", async () => {
  const s = sessionWithVerifiedWork();
  await s.refreshStaleness();
  const push = spacePush(s) as {
    subjects: {
      claims: {
        promises: {
          checks: {
            text: string;
            kind?: string;
            verdict?: string;
            tep?: string;
            accepted?: boolean;
            proof?: { path: string; test?: string };
            drifted?: boolean;
          }[];
        }[];
      }[];
    }[];
  };
  const [probe, review] = push.subjects[0].claims[0].promises[0].checks;

  assert.equal(probe.verdict, "green", "the newest delivery's verdict rides the check");
  assert.equal(probe.tep, "TEP-9", "named by the work that proved it");
  assert.equal(probe.accepted, true);
  assert.deepEqual(
    probe.proof,
    { path: "src/panel.test.ts", test: "panel follows the run" },
    "the standing proof's address — file and test name — is on the card",
  );
  assert.equal(
    probe.drifted,
    true,
    "the test file moved since the binding was stamped: proved-then, not proved-now",
  );

  assert.equal(review.kind, "assessment");
  assert.equal(review.verdict, "green", "the review verdict is state, not archaeology");
  assert.equal(
    review.drifted,
    undefined,
    "its promise's ground is current, so the verdict stands",
  );
});
