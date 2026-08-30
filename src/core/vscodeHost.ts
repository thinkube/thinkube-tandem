/**
 * The one way to reach the editor host.
 *
 * `vscode` is only ever importable inside a real editor process; every
 * other tree (a unit test, a headless run) has no such module. `require`
 * is resolved lazily, through the host runtime's own loader, so a file
 * that never calls `vs()` never needs `vscode` to exist at all.
 *
 * Reached from src/extension.ts and the host-ui files it loads. That file is
 * a product entry point: it is the extension's own `main` in package.json,
 * so the reachability gate resolves it without knip.json naming it again —
 * listing it there a second time is the redundancy knip itself reports.
 */
import type * as vscodeTypes from "vscode";
import { createRequire } from "node:module";

const req: NodeRequire = typeof require !== "undefined" ? require : createRequire(__filename);

export function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}
