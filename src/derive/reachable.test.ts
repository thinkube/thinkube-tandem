import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { auditProbeReachability, downgradeUnreachable, exportsSymbol, namedSymbols } from "./reachable";
import { buildGroundingPrompt } from "./ground";

test("the check's own words carry the symbols it names", () => {
  assert.deepEqual(namedSymbols("`ensureSession` and `ensureWorkSession()` are given the target space key"), ["ensureSession", "ensureWorkSession"]);
  assert.deepEqual(namedSymbols("pressing the button sends ensureSession(key) without consulting the pointer"), ["ensureSession"]);
  assert.deepEqual(namedSymbols("the docs page states the new behavior"), []);
});

test("export detection covers the common forms", () => {
  assert.ok(exportsSymbol("export function ensureSession(k) {}", "ensureSession"));
  assert.ok(exportsSymbol("export async function ensureSession(k) {}", "ensureSession"));
  assert.ok(exportsSymbol("function ensureSession() {}\nexport { ensureSession, other };", "ensureSession"));
  assert.ok(exportsSymbol("exports.ensureSession = ensureSession;", "ensureSession"));
  assert.ok(!exportsSymbol("function ensureSession() {}", "ensureSession"));
  assert.ok(!exportsSymbol("export function other() { ensureSession(); }", "ensureSession"));
});

test("a probe naming a symbol its touchpoint holds unexported is downgraded to an assessment, and the downgrade is said; exported, planned or prose names are left alone", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-reach-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "extension.ts"),
    "function ensureSession(key) { return key; }\nexport function activate() { ensureSession(''); }\n",
  );
  fs.writeFileSync(path.join(root, "src", "workSession.ts"), "export function ensureWorkSession(key) { return key; }\n");
  const node = {
    acceptance: [
      { text: "`ensureSession` is given the target space key without consulting the remembered pointer" },
      { text: "`ensureWorkSession` is given the target space key" },
      { text: "`plannedThing` opens its own tab" },
      { text: "the docs page states the new behavior", kind: "assessment" as const },
    ],
    touchpoints: [
      { path: "src/extension.ts" },
      { path: "src/workSession.ts" },
      { path: "src/planned.ts", planned: true },
    ],
  };
  const flags = auditProbeReachability(node, root);
  assert.deepEqual(flags.map((f) => [f.symbol, f.file]), [["ensureSession", "src/extension.ts"]]);
  const said: string[] = [];
  const n = downgradeUnreachable([node], root, (l) => said.push(l));
  assert.equal(n, 1);
  assert.equal(node.acceptance[0].kind, "assessment", "the unreachable probe is judged by a reviewer instead");
  assert.equal(node.acceptance[1].kind, undefined, "the exported seam stays a probe");
  assert.equal(node.acceptance[2].kind, undefined, "a planned file is not judged");
  assert.match(said[0], /ensureSession.*does not export/);
});

test("the grounding prompt judges reachability per seam and never bundles two seams in one check", () => {
  const prompt = buildGroundingPrompt({
    ask: { id: "a", text: "open each space in its own tab" },
    repoRoot: "/repo",
    digest: "",
    decisions: [],
  } as never);
  assert.ok(/PLAIN TEST PROCESS CAN REACH/.test(prompt));
  assert.ok(/Judge reachability PER SEAM/.test(prompt) && /naming two functions is TWO criteria/.test(prompt));
  assert.ok(/PLANNING THE SEAM/.test(prompt), "the preferred outcome is designing for testability");
});
