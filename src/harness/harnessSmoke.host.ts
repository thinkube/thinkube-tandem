/**
 * The harness's own smoke probe — also the CANONICAL EXAMPLE of a host probe
 * (the extension-host twin of `.tandem/conventions.json` → testExample):
 * runs inside a real VS Code extension host, activates this extension, and
 * asserts against the live `vscode` API. A surface-level acceptance probe
 * (`src/acceptance/SP-{spec}_AC-{ac}.host.ts`) follows exactly this shape.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension is present in the host");
  await ext.activate();
  assert.ok(ext.isActive, "the extension activates");
  const cmds = await vscode.commands.getCommands(true);
  assert.ok(
    cmds.includes("thinkube.scratchpad.open"),
    "the Scratchpad command is registered in the live host",
  );
}
