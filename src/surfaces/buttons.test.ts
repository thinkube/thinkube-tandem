/**
 * The button table, checked on the surface itself: the host's push for
 * every phase is rendered on every page, and each control is on exactly in
 * the phases the table says — what the reader sees, not the names behind it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spacePush } from "./panel";
import { PHASES, sessionInPhase } from "./phaseFixtures";
import { phaseOf } from "./phase";
import type { Phase } from "./phase";

const ROOT = path.resolve(__dirname, "..", "..");
const WEBVIEW = path.join(ROOT, "webview", "map");

/** control (data- name) → phases in which it is on. A control not listed
 *  is never gated. */
const TABLE: Record<string, readonly Phase[]> = {
  "read-draft": ["drafting", "read", "understood", "delivered"],
  "keep-draft": ["read"],
  think: ["read", "understood", "delivered"],
  "think-here": ["read", "understood", "delivered"],
  reground: ["understood", "delivered"],
  "edit-sentence": ["understood", "delivered"],
  "edit-from": ["understood", "delivered"],
  reframe: ["understood", "delivered"],
  amend: ["understood", "delivered"],
  "dismiss-promise": ["understood", "delivered"],
  "propose-check": ["understood", "delivered"],
  "accept-check": ["understood", "delivered"],
  "open-cut-review": ["understood", "delivered"],
  build: ["understood", "delivered"],
  rerun: ["signed"],
  "stop-run": ["running"],
  "accept-delivery": ["delivered"],
  panic: ["drafting", "read", "understood"],
  "switch-repo": ["drafting", "read", "understood", "signed", "delivered"],
};
/** Controls that must be on screen in a phase — the step's primary action. */
const PRESENT: Partial<Record<Phase, string[]>> = {
  drafting: ["read-draft"],
  read: ["keep-draft", "think"],
  understood: ["think", "edit-sentence"],
  signed: ["rerun"],
  delivered: ["accept-delivery"],
};

test("every button on every page is on exactly in the phases the table says", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-buttons-"));
  const pushes: Record<string, unknown> = {};
  for (const p of PHASES) {
    const s = sessionInPhase(p);
    assert.equal(phaseOf(s), p, `the fixture for ${p} is in that phase`);
    pushes[p] = spacePush(s);
  }
  const pushFile = path.join(dir, "pushes.json");
  fs.writeFileSync(pushFile, JSON.stringify(pushes));
  const bundle = path.join(ROOT, "out-test", "harness", "buttons.cjs");
  execFileSync("npm", ["run", "-s", "buttons"], { cwd: WEBVIEW, stdio: "pipe" });
  const seen = JSON.parse(execFileSync(process.execPath, [bundle, pushFile], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as Record<
    string,
    Record<string, string[]>
  >;
  const problems: string[] = [];
  for (const phase of PHASES) {
    const onScreen = new Set<string>();
    for (const [page, buttons] of Object.entries(seen[phase])) {
      for (const b of buttons) {
        const on = b.startsWith("on");
        const name = b.slice(4).split(/[ =]/)[0];
        onScreen.add(name);
        const phases = TABLE[name];
        if (!phases) continue;
        const should = phases.includes(phase);
        if (on !== should) problems.push(`${phase} · ${page} · ${name}: is ${on ? "on" : "off"}, must be ${should ? "on" : "off"}`);
      }
    }
    for (const must of PRESENT[phase] ?? []) if (!onScreen.has(must)) problems.push(`${phase}: ${must} is not on any page`);
  }
  assert.deepEqual(problems, [], "button table:\n" + problems.join("\n"));
});
