// WHY (INVARIANT): the button table says in which phases each control is
// on; an unlisted control is silently ungated. This proves the rendered
// surface's documentation-exemption control is on exactly in the phases
// the phase table allows it, checked on the built webview like every
// other control (via the harness, not through fakes).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const mapDir = path.join(repoRoot, "webview", "map");
const harnessOut = path.join(repoRoot, "out-test", "harness", "buttons.cjs");

function basePush(overrides) {
  return {
    kind: "space",
    running: false,
    phase: "understood",
    allowed: [],
    signedTeps: 0,
    questions: [],
    decisions: [],
    orphans: [],
    sentences: [],
    cost: { subjects: 0, rounds: 0 },
    outOfDate: { promises: 0, subjects: 0, rounds: 0 },
    ready: { subjects: 1, promises: 1, asks: 1, thinking: false },
    draft: "",
    impacts: [],
    subjects: [
      {
        id: "sub-1",
        name: "the widget",
        claims: [
          {
            id: "cl-1",
            text: "it resizes",
            fromAsk: "ask text",
            fromAskId: "ask-1",
            fromAskN: 1,
            promises: [
              {
                id: "n1",
                text: "the widget resizes",
                file: "src/widget.ts",
                checks: [{ text: "it resizes" }],
                needs: [],
                inCut: true,
                stale: false,
              },
            ],
          },
        ],
        from: [],
      },
    ],
    cutCount: 1,
    deliveries: [],
    ...overrides,
  };
}

test("the documentation-exemption control is on exactly in the phases the phase table allows, on the built webview", { timeout: 600000 }, () => {
  // The bundler this build needs lives in webview/map/node_modules, which an
  // isolated runner does not carry. Install it when it is absent so the
  // webview is genuinely built here rather than assumed to be pre-built.
  if (!fs.existsSync(path.join(mapDir, "node_modules", "vite"))) {
    execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: mapDir,
      stdio: "inherit",
    });
  }
  execFileSync("npm", ["run", "buttons"], { cwd: mapDir, stdio: "inherit" });
  assert.ok(fs.existsSync(harnessOut), `harness must build to ${harnessOut}`);

  const allowedInPhase = {
    drafting: ["excuse-docs"],
    understood: ["excuse-docs"],
    signed: [],
    running: [],
  };
  const pushes = {};
  for (const phase of Object.keys(allowedInPhase)) {
    pushes[phase] = basePush({
      phase,
      allowed: allowedInPhase[phase],
      running: phase === "running",
    });
  }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-buttons-")), "pushes.json");
  fs.writeFileSync(tmp, JSON.stringify(pushes));
  const raw = execFileSync("node", [harnessOut, tmp], { cwd: repoRoot }).toString();
  const table = JSON.parse(raw);

  for (const phase of Object.keys(allowedInPhase)) {
    const buttons = table[phase]?.work ?? [];
    const excuseButton = buttons.find((b) => b.includes("excuse-docs"));
    assert.ok(
      excuseButton,
      `phase "${phase}" must render a documentation-exemption control (buttons: ${JSON.stringify(buttons)})`,
    );
    const shouldBeOn = allowedInPhase[phase].includes("excuse-docs");
    assert.equal(
      excuseButton.startsWith("on"),
      shouldBeOn,
      `documentation-exemption control in phase "${phase}" must be ${shouldBeOn ? "on" : "off"}, was: ${excuseButton}`,
    );
  }
});
