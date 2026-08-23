/**
 * The rendered surface's documentation-exemption control is on exactly in the
 * phases the button table lists for it, checked on the built webview like
 * every other control.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { TandemSession } from "../surfaces/session";
import { spacePush } from "../surfaces/push";
import { emptySpace } from "../core/schema";
import type { Space } from "../core/schema";
import type { Phase } from "../surfaces/phase";

const PHASES: readonly Phase[] = [
  "drafting",
  "read",
  "understood",
  "signed",
  "running",
  "delivered",
];

/** The phases the button table lists for the documentation-exemption
 *  control. The rail offers it only inside its build section, and that
 *  section renders only while something is still buildable — so once a cut
 *  is signed the control is absent from the surface entirely. */
const ON_IN: readonly Phase[] = ["understood"];

const repoRoot = path.resolve(__dirname, "..", "..");
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
      resetup: async () => ({ provision: "", prepare: "", runOne: "" }),
      proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
  } as unknown as ConstructorParameters<typeof TandemSession>[0]);
}

function groundedSpace(): Space {
  return {
    ...emptySpace(),
    draft: "and the log stays readable",
    asks: [{ id: "ask-1", text: "the panel follows the run", at: "t" }],
    subjects: [{ id: "subject-t-1", name: "the panel", from: ["ask-1"] }],
    claims: [{ id: "cl-1", subjectId: "subject-t-1", text: "it follows", fromAsk: "ask-1" }],
    nodes: [
      {
        id: "n1",
        sentence: "the panel scrolls with the running step",
        serves: ["ask-1", "subject-t-1"],
        servesClaim: "cl-1",
        needs: [],
        grounding: { touchpoints: [{ path: "src/panel.ts" }], stamp: [CURRENT] },
        acceptance: [{ id: "c1", text: "opening the panel shows the live step", kind: "probe" }],
      },
    ],
  } as unknown as Space;
}

function sessionInPhase(phase: Phase): TandemSession {
  const s = bare();
  const signedCut = {
    id: "cut-1",
    changeIds: ["n1"],
    tepId: "TEP-1",
    signature: { at: "t", renderHash: "r", groundingHash: "g" },
  };
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
      s.space = groundedSpace();
      break;
    case "signed":
      s.space = { ...groundedSpace(), cuts: [signedCut] } as unknown as Space;
      break;
    case "running":
      s.space = { ...groundedSpace(), cuts: [signedCut] } as unknown as Space;
      s.running = true;
      break;
    case "delivered":
      s.space = {
        ...groundedSpace(),
        cuts: [signedCut],
        deliveries: [
          {
            id: "delivery-TEP-1",
            cutId: "cut-1",
            branch: "tandem/TEP-1",
            proofs: [
              {
                kind: "probe",
                label: "opening the panel shows the live step",
                verdict: "green",
                criterionId: "c1",
              },
            ],
          },
        ],
      } as unknown as Space;
      break;
  }
  return s;
}

test("the excuse-docs control is on exactly in the phases the button table lists for it", () => {
  const pushes: Record<string, unknown> = {};
  for (const phase of PHASES) pushes[phase] = spacePush(sessionInPhase(phase));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-render-ac11-"));
  const fixturePath = path.join(dir, "pushes.json");
  fs.writeFileSync(fixturePath, JSON.stringify(pushes));

  execFileSync("npm", ["run", "buttons"], {
    cwd: path.join(repoRoot, "webview", "map"),
    stdio: "pipe",
  });

  // The rail that is built must be the rail that offers the control: when the
  // tree built is not the tree the control was written into, an absent control
  // would read as a phase-table fault and be chased there.
  const railSource = fs.readFileSync(
    path.join(repoRoot, "webview", "map", "src", "Rail.tsx"),
    "utf8",
  );
  assert.ok(
    /data-excuse-docs\b/.test(railSource),
    "the rail being built offers no excuse-docs control at all — the surface under test is not the surface that was written",
  );

  const harness = path.join(repoRoot, "out-test", "harness", "buttons.cjs");
  const raw = execFileSync("node", [harness, fixturePath], { encoding: "utf8" });
  const table = JSON.parse(raw) as Record<string, Record<string, string[]>>;

  for (const phase of PHASES) {
    const wantOn = ON_IN.includes(phase);
    const buttons = table[phase]["work"];
    const line = buttons.find((b) =>
      b
        .slice(4)
        .split(" ")
        .some((token) => token === "excuse-docs" || token.startsWith("excuse-docs=")),
    );
    const isOn = !!line && line.startsWith("on");
    assert.equal(
      isOn,
      wantOn,
      `phase ${phase}: expected excuse-docs ${wantOn ? "on" : "off/absent"}, saw ${JSON.stringify(line)}` +
        `\nthe controls the surface rendered on this page:\n${buttons.join("\n")}`,
    );
  }
});
