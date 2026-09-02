/**
 * What a repository declares about its parts reaches the door and the
 * placement of checks: each part's own single-test command, and each part
 * as a tree where checks may be born.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { declaredPartCommands } from "./whatWeKnow";
import { docsRootsOf } from "../core/docsDuty";

function repoWith(yaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parts-"));
  fs.writeFileSync(path.join(dir, "thinkube.yaml"), yaml);
  return dir;
}

test("each declared one-test command is told to the door under its part's root", () => {
  const dir = repoWith(
    [
      "apiVersion: thinkube.io/v1",
      "kind: ThinkubeDeployment",
      "spec:",
      "  containers:",
      "    - { name: backend, build: ./backend, test: { enabled: true, command: x, one: 'pytest <file>' } }",
      "    - { name: frontend, build: ./frontend, test: { enabled: true, command: y } }",
      "",
    ].join("\n"),
  );
  assert.deepEqual(declaredPartCommands(dir), { backend: { runOne: "pytest <file>" } });
});

test("a repository with no declaration tells the door nothing", () => {
  assert.deepEqual(declaredPartCommands(fs.mkdtempSync(path.join(os.tmpdir(), "parts-"))), {});
});

test("the declared documentation root wins, and an Antora site inside it is recognised", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
  assert.deepEqual(docsRootsOf(dir, "docs"), ["docs"], "plain markdown under docs/");
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "antora.yml"), "name: x\n");
  assert.deepEqual(docsRootsOf(dir, "docs"), ["docs/modules"], "an Antora site: its pages live in the modules");
});
