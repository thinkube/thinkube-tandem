/**
 * The button table: for every phase, which shaping controls the built
 * webview renders as on. Built fresh from real sessions and a real push
 * (`spacePush`), rendered by the harness with no host, so a control that is
 * silently ungated in the phase table shows up here as a control on screen
 * in a phase nobody allowed it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import { emptySpace } from "../core/schema";
import type { Space } from "../core/schema";
import type { Phase } from "./phase";

/** Every phase the phase table recognizes, in the order phase.ts's own
 *  doc-comment lists them — the fixture this test builds one session per. */
const PHASES: readonly Phase[] = [
  "drafting",
  "read",
  "understood",
  "signed",
  "running",
  "delivered",
];

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

/**
 * A space with one ask, thought all the way through: the subject is
 * GROUNDED (a node serves it by id, "subject-" prefixed, matching the
 * real reading's own convention — see modelFlow.ts) so `readyToBuild`
 * reports something ready and the rail's build section — the only place
 * "excuse-docs" is offered — actually renders.
 */
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

/** One session per phase, built the way the host would build it, with a
 *  buildable component so every control that only shows up once there is
 *  something to build — like "excuse-docs" — is on the page to be judged. */
function sessionInPhase(phase: Phase): TandemSession {
  const s = bare();
  const signedCut = { id: "cut-1", changeIds: ["n1"], tepId: "TEP-1", signature: { at: "t", renderHash: "r", groundingHash: "g" } };
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
            proofs: [{ kind: "probe", label: "opening the panel shows the live step", verdict: "green", criterionId: "c1" }],
          },
        ],
      } as unknown as Space;
      break;
  }
  return s;
}

/**
 * The button table: every gated control the rail and the graphs offer,
 * with the phases it must render ON in. A control left out here is a
 * control the phase table can silently ungate forever — the whole reason
 * this test exists — so every entry in phase.ts's ALLOWED that has a data
 * attribute on the built surface belongs in this table.
 */
const TABLE: Record<string, readonly Phase[]> = {
  // The rail offers these three only inside its build section, and that
  // section renders only while something is still buildable
  // (`ready.subjects > 0`). Once a cut is signed its promises are no longer
  // buildable, so in "signed", "running" and "delivered" the section — and
  // every control in it — is absent from the surface, whatever the phase
  // table would let the host act on.
  "open-cut-review": ["understood"],
  "excuse-docs": ["understood"],
  build: ["understood"],
};

test("the button table: every gated control is on exactly in its listed phases", () => {
  const pushes: Record<string, unknown> = {};
  for (const phase of PHASES) pushes[phase] = spacePush(sessionInPhase(phase));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-buttons-"));
  const fixturePath = path.join(dir, "pushes.json");
  fs.writeFileSync(fixturePath, JSON.stringify(pushes));

  execFileSync("npm", ["run", "buttons"], {
    cwd: path.join(repoRoot, "webview", "map"),
    stdio: "pipe",
  });

  const harness = path.join(repoRoot, "out-test", "harness", "buttons.cjs");
  // The rail that is built must be the rail that offers the controls: when
  // the tree being built is not the tree the controls were written into, a
  // missing control reads as a phase-table fault and is chased there.
  const railPath = path.join(repoRoot, "webview", "map", "src", "Rail.tsx");
  const railSource = fs.readFileSync(railPath, "utf8");
  for (const action of Object.keys(TABLE))
    assert.ok(
      new RegExp(`data-${action}\\b`).test(railSource),
      `the rail being built offers no "${action}" control at all — the surface under test is not the surface that was written; it reads:\n${railSource.slice(0, 1200)}`,
    );
  const raw = execFileSync("node", [harness, fixturePath], { encoding: "utf8" });
  const table = JSON.parse(raw) as Record<string, Record<string, string[]>>;

  for (const [action, phases] of Object.entries(TABLE)) {
    for (const phase of PHASES) {
      const wantOn = (phases as readonly Phase[]).includes(phase);
      // "work" is the only tab the rail's build section renders on
      // (App.tsx passes canBuild={tab === "work"}); every other tab must
      // never carry the control at all.
      const buttons = table[phase]["work"];
      // The harness lists a button by its data-attribute names with the
      // `data-` prefix stripped ("on  open-cut-review"), so the control is
      // matched as a whole token — `build` must not match `build-price`.
      const line = buttons.find((b) =>
        b
          .slice(4)
          .split(" ")
          .some((token) => token === action || token.startsWith(`${action}=`)),
      );
      const isOn = !!line && line.startsWith("on");
      assert.equal(
        isOn,
        wantOn,
        `phase ${phase}, action ${action}: expected ${wantOn ? "on" : "off/absent"}, saw ${JSON.stringify(line)}` +
          `\nthe controls the surface rendered on this page:\n${buttons.join("\n")}` +
          `\nthe markup around the control:\n${(() => {
            const html = (table[phase][`work-html`] ?? [""])[0];
            const i = html.indexOf(action);
            if (i >= 0) return html.slice(Math.max(0, i - 400), i + 400);
            const j = html.indexOf("data-build-section");
            return (
              `"${action}" is nowhere in the ${html.length} characters of markup; ` +
              (j < 0
                ? "and the build section is not there either"
                : `the build section reads:\n${html.slice(j, j + 2500)}`)
            );
          })()}`,
      );
    }
  }
});
