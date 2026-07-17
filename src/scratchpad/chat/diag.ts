/**
 * Thinky diagnostics channel (2026-07-17 field debugging): unconditional,
 * lightweight lines into the "Thinkube Scratchpad" output AND a plain file
 * (~/.thinky-diag.log) so field sessions can be diagnosed without the human
 * hunting panels — the assistant reads the file directly.
 */
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import type * as vscode from "vscode";
function vs(): typeof vscode {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("vscode") as typeof vscode;
}
let _channel: vscode.OutputChannel | undefined;
const LOG_FILE = nodePath.join(nodeOs.homedir(), ".thinky-diag.log");
export function thinkyDiag(line: string): void {
  const stamped = `${new Date().toISOString()} [thinky] ${line}`;
  try {
    nodeFs.appendFileSync(LOG_FILE, stamped + "\n");
  } catch {
    /* read-only home — channel still gets it */
  }
  try {
    _channel ??= vs().window.createOutputChannel("Thinkube Scratchpad");
    _channel.appendLine(stamped);
  } catch {
    /* headless test host */
  }
}
