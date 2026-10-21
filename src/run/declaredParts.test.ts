/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { declaredPartCommands, knownUnderDeclaration, toldByDeclaration } from "./whatWeKnow";
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
  assert.deepEqual(declaredPartCommands(dir), { backend: { runOne: "pytest <file>", suite: "x" } });
});

test("a repository with no declaration tells the door nothing", () => {
  assert.deepEqual(declaredPartCommands(fs.mkdtempSync(path.join(os.tmpdir(), "parts-"))), {});
});

/** One container built from the whole repository, as twelve apps declare it. */
const ROOT_BUILT = [
  "apiVersion: thinkube.io/v1",
  "kind: ThinkubeDeployment",
  "spec:",
  "  containers:",
  "    - name: db",
  "      build: .",
  "      test:",
  "        enabled: true",
  '        command: "./run_tests.sh"',
  '        one: "./run_tests.sh <file>"',
  "",
].join("\n");

test("a container built from \".\" that says how one test runs is the repository-wide command and suite", () => {
  const dir = repoWith(ROOT_BUILT);
  assert.deepEqual(declaredPartCommands(dir), { ".": { runOne: "./run_tests.sh <file>", suite: "./run_tests.sh" } });
  assert.deepEqual(toldByDeclaration(dir), { runOne: "./run_tests.sh <file>", suite: "./run_tests.sh" }, "no part of its own: it is the repository");
});

test("beside other parts, the \".\" part's command is the repository-wide one and theirs stay their own", () => {
  const dir = repoWith(
    [
      "apiVersion: thinkube.io/v1",
      "kind: ThinkubeDeployment",
      "spec:",
      "  containers:",
      "    - { name: backend, build: ./backend, test: { enabled: true, command: pytest, one: 'pytest <file>' } }",
      "    - { name: frontend, build: '.', test: { enabled: true, one: 'npx vitest run <file>' } }",
      "",
    ].join("\n"),
  );
  assert.deepEqual(toldByDeclaration(dir), {
    parts: { backend: { runOne: "pytest <file>", suite: "pytest" } },
    runOne: "npx vitest run <file>",
  });
});

test("parts with commands and no \".\" command want nothing repository-wide; no declaration tells nothing", () => {
  const dir = repoWith(
    "spec:\n  containers:\n    - { name: backend, build: ./backend, test: { enabled: true, one: 'pytest <file>' } }\n",
  );
  assert.deepEqual(toldByDeclaration(dir), { parts: { backend: { runOne: "pytest <file>" } }, runOne: "" });
  assert.deepEqual(toldByDeclaration(fs.mkdtempSync(path.join(os.tmpdir(), "parts-"))), {});
});

test("a remembered suite gives way to the declared one; without a declared suite it stands", () => {
  const known = { runOne: "pytest <file>", suite: "pytest" };
  assert.deepEqual(knownUnderDeclaration(known, "./run_tests.sh"), { runOne: "pytest <file>" });
  assert.equal(knownUnderDeclaration(known, undefined), known);
  assert.equal(knownUnderDeclaration(known, "pytest"), known);
  assert.equal(knownUnderDeclaration(undefined, "./run_tests.sh"), undefined);
});

test("the declared documentation root wins, and an Antora site inside it is recognised", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
  assert.deepEqual(docsRootsOf(dir, "docs"), ["docs"], "plain markdown under docs/");
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "antora.yml"), "name: x\n");
  assert.deepEqual(docsRootsOf(dir, "docs"), ["docs/modules"], "an Antora site: its pages live in the modules");
});
