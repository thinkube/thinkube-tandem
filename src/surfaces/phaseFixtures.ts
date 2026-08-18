/**
 * One session per phase, built from a real record, so the surface can be
 * driven through every phase with the pushes the host would send — the
 * button table is checked against what is on screen, not against the
 * names of the actions behind it.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { emptySpace } from "../core/schema";
import type { Space } from "../core/schema";
import type { Phase } from "./phase";

const CURRENT = { root: "/repo", head: "h2", dirty: "" };

function bare(): TandemSession {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "2026-08-18T10:00:00Z",
    author: "t",
    classify: async () => "ask" as const,
    readCurrentStamp: async () => [CURRENT],
    knowledge: async () => ({
      repoRoot: "/repo",
      graph: { graphPath: "/g.json", stamp: CURRENT },
      map: "",
      digest: "",
      provision: "",
      prepare: "",
      resetup: async () => ({ provision: "", prepare: "" }),
      proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
  } as unknown as ConstructorParameters<typeof TandemSession>[0]);
}

/** A space with one ask understood: a subject, a claim, a promise with a check. */
function understoodSpace(): Space {
  return {
    ...emptySpace(),
    // Text in the box, so Read is judged with something to read.
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
  } as unknown as Space;
}

/** The session for a phase. */
export function sessionInPhase(phase: Phase): TandemSession {
  const s = bare();
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
        cuts: [{ id: "cut-1", changeIds: ["n1"], tepId: "TEP-1", signature: "sig", signedAt: "t" }],
      } as unknown as Space;
      break;
    case "running":
      s.space = {
        ...understoodSpace(),
        cuts: [{ id: "cut-1", changeIds: ["n1"], tepId: "TEP-1", signature: "sig", signedAt: "t" }],
      } as unknown as Space;
      s.running = true;
      break;
    case "delivered":
      s.space = {
        ...understoodSpace(),
        cuts: [{ id: "cut-1", changeIds: ["n1"], tepId: "TEP-1", signature: "sig", signedAt: "t" }],
        deliveries: [
          {
            id: "delivery-TEP-1",
            cutId: "cut-1",
            branch: "tandem/TEP-1",
            proofs: [{ kind: "probe", label: "opening the panel shows the live step", verdict: "green", criterionId: "c1" }],
          },
        ],
      } as unknown as Space;
      break;
  }
  return s;
}

export const PHASES: readonly Phase[] = ["drafting", "read", "understood", "signed", "running", "delivered"];
