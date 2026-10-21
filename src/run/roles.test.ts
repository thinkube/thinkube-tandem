/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The roles are files in the shape Claude Code reads; a repository may say
 * a role's words its own way, and never its tools.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentDefinitionOf, isOwn, ROLE_NAMES, roleDefinition, roleNameFor } from "./roles";

test("every role ships as a file with a description and words of its own", () => {
  for (const name of ROLE_NAMES) {
    const r = roleDefinition(name);
    assert.equal(r.name, name);
    assert.ok(r.description.length > 20, `${name} says who it is`);
    assert.match(r.prompt, /Tandem run/, `${name} knows what it is part of`);
    assert.match(r.prompt, /final summary/, `${name} knows how it leaves`);
    assert.equal(isOwn(r), false);
  }
});

test("a worker runs as its role; the unfenced last actor is the closer whatever it was handed", () => {
  assert.equal(roleNameFor({ role: "code" }), "tandem-coder");
  assert.equal(roleNameFor({ role: "test" }), "tandem-tester");
  assert.equal(roleNameFor({ role: "test", unfenced: true }), "tandem-closer");
});

test("a repository's own role file gives the words, the effort and the turns, and not the tools", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-roles-"));
  fs.mkdirSync(path.join(repo, ".claude", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".claude", "agents", "tandem-tester.md"),
    ["---", "name: tandem-tester", "description: Our tester, who writes vitest.", "effort: high", "maxTurns: 30", "tools: Bash, Read", "---", "You write vitest, nothing else.", ""].join("\n"),
  );
  const r = roleDefinition("tandem-tester", repo);
  assert.equal(isOwn(r), true);
  assert.equal(r.description, "Our tester, who writes vitest.");
  assert.equal(r.prompt, "You write vitest, nothing else.");
  assert.deepEqual(agentDefinitionOf(r), {
    description: "Our tester, who writes vitest.",
    prompt: "You write vitest, nothing else.",
    effort: "high",
    maxTurns: 30,
  });
  assert.equal("tools" in agentDefinitionOf(r), false, "the tools are the run's rule");
  assert.equal(isOwn(roleDefinition("tandem-coder", repo)), false, "a role the repository does not override is the bundled one");
});

test("a role file with no words is an error naming the file, never a worker running as nobody", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-roles-"));
  fs.writeFileSync(path.join(dir, "tandem-coder.md"), "---\nname: tandem-coder\ndescription: a coder\n---\n\n");
  assert.throws(() => roleDefinition("tandem-coder", undefined, dir), /tandem-coder\.md has no words/);
  assert.throws(() => roleDefinition("tandem-tester", undefined, dir), /ENOENT|no such file/);
});
