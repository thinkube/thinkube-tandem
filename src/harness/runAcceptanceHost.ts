/**
 * Extension-host acceptance-probe runner (TEP-21/SP-2 — subject fidelity).
 *
 * Launches a real VS Code (downloaded once into a shared cache, run under
 * xvfb on a headless host) with THIS repo as the development extension, and
 * executes one compiled host-probe file inside the extension host. This is
 * the harness that lets a surface-level acceptance criterion ("a person opens
 * the panel and…") be verified at its own altitude instead of degrading to a
 * component probe — the car/tricycle gap seen on SP-21/1.
 *
 * Usage: node out-test/test/runAcceptanceHost.js <compiled-probe.js>
 * The probe module exports `run(): Promise<void>` and throws on failure; it
 * runs INSIDE the extension host, so `require("vscode")` is available.
 * Exit 0 = the probe passed; non-zero = failed (the closing gate's contract).
 */
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import {
  downloadAndUnzipVSCode,
  runTests,
} from "@vscode/test-electron";

async function main(): Promise<void> {
  const probe = process.argv[2];
  // Multi-phase probes (resume across a REAL host restart): a probe that
  // declares `// TANDEM_PHASES=2` is launched once per phase, each in a FRESH
  // extension host; `run(phase)` receives the 0-based phase. Phase 0 authors
  // state and exits; phase 1 starts cold and asserts the state came back —
  // the only honest way to verify "reopened after the host restarted".
  const phases = Math.max(1, Number.parseInt(process.argv[3] ?? "1", 10) || 1);
  if (!probe) {
    console.error(
      "usage: node runAcceptanceHost.js <compiled-probe.js> [phases] — the probe exports run(phase): Promise<void>",
    );
    process.exit(2);
  }
  // out-test/test/ → repo root, two levels up (mirrors the acceptance probes' ROOT).
  const repoRoot = path.resolve(__dirname, "../../");
  // One shared download cache OUTSIDE every worktree: oracle runners are fresh
  // checkouts, and a per-worktree cache would re-download VS Code every round.
  const cachePath = path.join(os.homedir(), ".vscode-test-shared");
  // A throwaway empty workspace: probes must not depend on (or disturb) the
  // developer's real workspace state. Must EXIST before launch — VS Code's CLI
  // hands a nonexistent path to the module loader and dies MODULE_NOT_FOUND.
  const wsDir = path.join(os.tmpdir(), "tandem-host-probe-ws");
  fs.mkdirSync(wsDir, { recursive: true });
  // Environment sanitation: when this runner is itself spawned from a VS Code /
  // code-server extension host (the orchestrator's gate, a Claude session),
  // ELECTRON_RUN_AS_NODE and VSCODE_* IPC vars leak in — the launched VS Code
  // then runs as plain Node and `require()`s its first positional arg instead
  // of starting the workbench (the same leak deploy.sh strips for the CLI).
  delete process.env.ELECTRON_RUN_AS_NODE;
  for (const k of Object.keys(process.env))
    if (k.startsWith("VSCODE_")) delete process.env[k];
  try {
    const vscodeExecutablePath = await downloadAndUnzipVSCode({ cachePath });
    for (let phase = 0; phase < phases; phase++) {
      await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath: repoRoot,
        extensionTestsPath: path.resolve(__dirname, "acceptanceHostMain.js"),
        extensionTestsEnv: {
          TANDEM_HOST_PROBE: path.resolve(probe),
          TANDEM_HOST_PHASE: String(phase),
        },
        launchArgs: [
          wsDir,
          "--disable-workspace-trust",
          "--disable-gpu",
          "--no-sandbox",
          "--disable-extensions", // only OUR development extension loads
        ],
      });
    }
  } catch {
    process.exit(1);
  }
}

void main();
