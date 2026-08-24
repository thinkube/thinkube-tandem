/**
 * The panel's build section carries a text box for the reason
 * documentation is not needed. When the push carries a reason, the box
 * must render that reason as its value — an empty box beside a refusal
 * that requires text would look answered when it is not, and a person
 * would sign believing they wrote something they did not.
 *
 * STANDING INVARIANT — the Rail's build section renders push.docsNotNeeded
 * as the value of its reason box, never leaving it empty when the push
 * carries one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { TandemSession, SessionDeps } from "../surfaces/session";
import { spacePush } from "../surfaces/push";

/**
 * The Rail is React source in `webview/map`, a separate npm package with
 * its own compiler settings (esnext + react-jsx) and its own react. This
 * root suite is commonjs with no JSX and no react of its own, so the Rail
 * is compiled and resolved through the webview package here rather than
 * pulled into the root build.
 *
 * react-dom/server's renderToStaticMarkup is the same no-DOM rendering
 * path webview/map/harness/buttons.tsx already uses to read this webview
 * without a browser — no fake DOM, no new rendering approach.
 */
// __dirname is this compiled test's own directory under out-test/gates/,
// mirroring its source location under src/gates/ — the same depth, so ".."
// per directory level plus one for out-test reaches webview/map.
const mapRoot = path.resolve(__dirname, "..", "..", "webview", "map");
const fromMap = createRequire(path.join(mapRoot, "package.json"));

/** Compile one webview source file to commonjs and load it, resolving its
 *  relative imports the same way, so the Rail runs as its own package. */
function loadFromMap(spec: string, cache: Map<string, unknown> = new Map()): Record<string, unknown> {
  const file = ["", ".tsx", ".ts"]
    .map((ext) => spec + ext)
    .find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  assert.ok(file, `webview source not found: ${spec}`);
  const hit = cache.get(file!);
  if (hit) return hit as Record<string, unknown>;

  const ts = fromMap("typescript") as {
    ModuleKind: { CommonJS: unknown };
    ScriptTarget: { ES2022: unknown };
    JsxEmit: { ReactJSX: unknown };
    transpileModule: (
      input: string,
      opts: { compilerOptions: Record<string, unknown>; fileName: string },
    ) => { outputText: string };
  };
  const js = ts.transpileModule(fs.readFileSync(file!, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: file!,
  }).outputText;

  const exports: Record<string, unknown> = {};
  cache.set(file!, exports);
  const dir = path.dirname(file!);
  const require_ = (req: string) =>
    req.startsWith(".")
      ? loadFromMap(path.resolve(dir, req.replace(/\.(tsx?|jsx?)$/, "")), cache)
      : fromMap(req);
  new Function("exports", "require", "module", "__filename", "__dirname", js)(
    exports,
    require_,
    { exports },
    file!,
    dir,
  );
  return exports;
}

function fakeDeps(dir: string): SessionDeps {
  return {
    round: { model: "fake-model", repoRoot: dir },
    storeDir: path.join(dir, "store"),
    storageDir: path.join(dir, "storage"),
    now: () => "2026-08-24T00:00:00Z",
    author: "t",
  };
}

test("the build section renders the reason the push carries as the value of its box, not an empty box", () => {
  const React = fromMap("react") as {
    createElement: (type: unknown, props: unknown) => unknown;
  };
  const { renderToStaticMarkup } = fromMap("react-dom/server") as {
    renderToStaticMarkup: (n: unknown) => string;
  };
  const { Rail } = loadFromMap(path.join(mapRoot, "src", "Rail")) as {
    Rail: (props: unknown) => unknown;
  };

  const reason = "internal rename, nothing a reader of the docs would ever see";

  // The push is built by the REAL production path — a session told the
  // reason, rendered through `spacePush` — not a literal written here. A
  // hand-built payload proves only that the Rail can render a field some
  // test typed; it stays green even if `spacePush` stopped carrying the
  // reason at all. Driving the actual builder is what makes this check
  // reach the seam the promise lands in: session → push → box.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-rail-docs-"));
  const session = new TandemSession(fakeDeps(dir));
  session.sayDocsNotNeeded(reason);
  const built = spacePush(session) as Record<string, unknown> & { docsNotNeeded?: string };

  // The reason must be on the payload the production builder returned —
  // this is the assertion a stubbed `spacePush` cannot survive.
  assert.equal(
    built.docsNotNeeded,
    reason,
    "the push the panel is actually sent must carry the reason before the Rail can render it",
  );

  // The build section only draws when the space has work ready to sign
  // (`ready.subjects`), which an empty space does not. Standing that one
  // field up lets the section render; every other field — the reason
  // included — is the production builder's own output, so what is asserted
  // below is still what `spacePush` produced.
  const push = { ...built, ready: { subjects: 1, promises: 1, asks: 1, thinking: false } };
  assert.equal(push.docsNotNeeded, reason, "the reason rendered is the one the builder produced");

  const html = renderToStaticMarkup(
    React.createElement(Rail as never, { push: push as never, canBuild: true }),
  );

  assert.match(
    html,
    new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the reason the push carries appears as the value of the build section's box",
  );
});
