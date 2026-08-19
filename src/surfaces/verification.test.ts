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
      provision: "", prepare: "", runOne: "", suiteReds: [], rememberSuiteReds: () => {}, resetup: async () => ({ provision: "", prepare: "", runOne: "" }), proveSetup: () => {},
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
        unverified: [{ text: "the panel opens in the running editor", why: "needs the running extension" }],
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
          unverified?: { text: string; why: string }[];
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
  const promise = push.subjects[0].claims[0].promises[0];
  const [probe, review] = promise.checks;
  assert.deepEqual(
    promise.unverified,
    [{ text: "the panel opens in the running editor", why: "needs the running extension" }],
    "an effect the machine cannot verify rides the promise as a note with its reason — not as a check, not as a red mark",
  );

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

test("a withheld delivery keeps the signed work reachable: the cut is still unrun and the page offers to run again", () => {
  const s = sessionWithVerifiedWork();
  s.space = {
    ...s.space,
    deliveries: s.space.deliveries.map((d) => ({ ...d, acceptedAt: undefined, withheld: "the suite is red after the work" })),
  };
  const unrun = s.unrunCut();
  assert.ok(unrun, "a withheld delivery delivered nothing — the cut is still waiting to run");
  const push = spacePush(s) as { deliveries: { withheld?: string; rerun?: { id: string } }[] };
  assert.equal(push.deliveries[0].withheld, "the suite is red after the work");
  assert.equal(push.deliveries[0].rerun?.id, unrun!.id, "the way back in is on the delivery's page");
});

test("the phase gates the controls: the confirmed table, row by row — what the surface disables is what the host refuses", async () => {
  const { allowedNow, phaseOf, refusedNow } = await import("./phase");
  const s = sessionWithVerifiedWork();
  assert.equal(phaseOf(s), "understood", "an accepted delivery leaves nothing waiting");
  s.space = { ...s.space, deliveries: s.space.deliveries.map((d) => ({ ...d, acceptedAt: undefined })) };
  assert.equal(phaseOf(s), "delivered", "an open delivery is the delivered phase");

  const PHASES = ["drafting", "read", "understood", "signed", "running", "delivered"] as const;
  // control → the phases in which it is on (● in the table the human confirmed)
  const TABLE: Record<string, readonly (typeof PHASES)[number][]> = {
    "read-draft": ["drafting", "read", "understood", "delivered"],
    "keep-draft": ["read"],
    "cancel-capture": ["read"],
    think: ["read", "understood", "delivered"],
    reground: ["understood", "delivered"],
    reframe: ["understood", "delivered"],
    amend: ["understood", "delivered"],
    "dismiss-promise": ["understood", "delivered"],
    "propose-check": ["understood", "delivered"],
    "accept-check": ["understood", "delivered"],
    "open-cut-review": ["understood", "delivered"],
    build: ["understood", "delivered"],
    rerun: ["signed"],
    "stop-run": ["running"],
    "accept-delivery": ["delivered"],
    panic: ["drafting", "read", "understood"],
    "switch-repo": ["drafting", "read", "understood", "signed", "delivered"],
  };
  for (const [action, on] of Object.entries(TABLE))
    for (const phase of PHASES) {
      const refused = refusedNow(action, phase);
      if (on.includes(phase)) assert.equal(refused, undefined, `${action} is on in ${phase}`);
      else assert.match(refused ?? "", /^not now: /, `${action} is off in ${phase}`);
      assert.equal(allowedNow(phase).includes(action), on.includes(phase), `${action} in ${phase}: the surface's list agrees`);
    }
  // Reading, selecting, answering a parked worker and saving the text are never refused.
  for (const phase of PHASES)
    for (const action of ["answer-worker", "read-log", "select-unit", "save-draft", "retry-model", "pin"])
      assert.equal(refusedNow(action, phase), undefined, `${action} is always on (${phase})`);
  // Each refusal says why, in the phase's own words.
  assert.match(refusedNow("build", "running") ?? "", /a run is in flight/);
  assert.match(refusedNow("build", "signed") ?? "", /waiting to run/);
});
