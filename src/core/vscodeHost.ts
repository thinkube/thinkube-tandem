/**
 * The one way to reach the editor host.
 *
 * `vscode` is only ever importable inside a real editor process; every
 * other tree (a unit test, a headless run) has no such module. `require`
 * is resolved lazily, through the host runtime's own loader, so a file
 * that never calls `vs()` never needs `vscode` to exist at all.
 */
import type * as vscodeTypes from "vscode";
import { createRequire } from "node:module";

const req: NodeRequire = typeof require !== "undefined" ? require : createRequire(__filename);

export function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}
