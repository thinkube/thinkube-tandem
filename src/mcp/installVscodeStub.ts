/**
 * Side-effect module: install a `Module._resolveFilename` hook that
 * redirects `require('vscode')` to our stub. Must be imported as the very
 * first statement of `kanbanMcpServer.ts` so the hook is in place before
 * any other module loads and triggers a `require('vscode')` chain.
 *
 * Compiled-JS ordering matters: the TypeScript imports at the top of
 * `kanbanMcpServer.ts` become sequential `require()` calls. Putting
 * `import "./installVscodeStub"` first guarantees this file runs before
 * `require("../github/AuthService")` etc. would otherwise blow up.
 */
import Module from "node:module";
import * as path from "node:path";

const stubPath = path.join(__dirname, "vscodeStub.js");

interface ResolverInternals {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
}

const ModuleInternals = Module as unknown as ResolverInternals;
const originalResolve = ModuleInternals._resolveFilename;

ModuleInternals._resolveFilename = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
): string {
  if (request === "vscode") return stubPath;
  return originalResolve.call(this, request, ...rest);
};
