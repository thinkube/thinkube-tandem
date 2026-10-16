/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A declared single-check command that installs again on every check gives
 * way, for single checks, to the repository's own plain runner from
 * `.tandem/setup.json`; the door proves that one, uses it, and records it.
 * The whole suite still runs as declared.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runsProvisioning, singleCheckFor } from "./plainRunOne";
import { setupRunTree } from "./setup";
import { whatWeKnow } from "./whatWeKnow";
import { factsOf } from "./facts";
import { emptySpace } from "../core/schema";

const PROVISION = "pip install --break-system-packages -q -r requirements.txt pytest==8.4.2";
const PLAIN = "python3 -m pytest -q -p no:cacheprovider <file>";
const DECLARED = "./run_tests.sh <file>";

/** A repository shaped like tkt-kubexlat-ingestion: a test script that installs, then runs pytest. */
function repository(facts: { runOne: string }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-plain-"));
  fs.writeFileSync(
    path.join(root, "run_tests.sh"),
    `#!/bin/sh\nset -e\n${PROVISION}\nexec python3 -m pytest -q -p no:cacheprovider "\${1:-tests}"\n`,
  );
  fs.writeFileSync(
    path.join(root, "thinkube.yaml"),
    "apiVersion: thinkube.io/v1\nkind: ThinkubeDeployment\nmetadata:\n  version: \"0.1.0\"\nspec:\n  deployment:\n    type: knative\n" +
      "  containers:\n    - name: ingestion\n      build: .\n      port: 8080\n      test:\n        enabled: true\n" +
      `        command: "./run_tests.sh"\n        one: "${DECLARED}"\n`,
  );
  fs.mkdirSync(path.join(root, ".tandem"));
  fs.writeFileSync(
    path.join(root, ".tandem", "setup.json"),
    JSON.stringify({ provision: PROVISION, prepare: "", runOne: facts.runOne, suite: "./run_tests.sh" }),
  );
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "tests", "test_health.py"), "def test_health():\n    assert True\n");
  return root;
}

test("a declared command whose script runs the provisioning installs again; a plain runner does not", () => {
  const root = repository({ runOne: PLAIN });
  assert.equal(runsProvisioning(root, DECLARED, PROVISION), true);
  assert.equal(runsProvisioning(root, PLAIN, PROVISION), false);
  assert.equal(runsProvisioning(root, `${PROVISION} && pytest <file>`, PROVISION), true, "the install written into the command itself");
  assert.equal(runsProvisioning(root, DECLARED, ""), false, "no provisioning, nothing repeated");
});

test("the repository's own runner is chosen when the declared one installs again", () => {
  const root = repository({ runOne: PLAIN });
  const chosen = singleCheckFor({ worktree: root, declared: DECLARED, provision: PROVISION, facts: PLAIN });
  assert.equal(chosen.kind, "plain");
  assert.equal(chosen.kind === "plain" && chosen.plain, PLAIN);

  const none = singleCheckFor({ worktree: root, declared: DECLARED, provision: PROVISION, facts: DECLARED });
  assert.equal(none.kind, "reprovisions", "the facts name only the declared command");
  assert.match(none.kind === "reprovisions" ? none.why : "", /record the plain runner there as "runOne"/);

  assert.equal(singleCheckFor({ worktree: root, declared: PLAIN, provision: PROVISION, facts: PLAIN }).kind, "declared");
});

test("the door proves the plain runner first, and the declared one when the plain one does not hold", async () => {
  const root = repository({ runOne: PLAIN });
  const exec = async (cmd: string, args: string[]) =>
    cmd === "git" && args.includes("ls-files") ? { code: 0, out: "tests/test_health.py\nrun_tests.sh\n" } : { code: 0, out: "" };

  const ran: string[] = [];
  const held = await setupRunTree({
    worktree: root,
    runOne: DECLARED,
    runOneDeclared: true,
    plainRunOne: PLAIN,
    exec,
    boundedExec: async (cmd) => {
      ran.push(cmd);
      return { code: 0, output: "1 passed in 0.01s" };
    },
    log: () => {},
  });
  assert.equal(String(held.runOne), PLAIN);
  assert.ok(!ran.includes("./run_tests.sh tests/test_health.py"), "the declared script was not run");

  const said: string[] = [];
  const fellBack = await setupRunTree({
    worktree: root,
    runOne: DECLARED,
    runOneDeclared: true,
    plainRunOne: PLAIN,
    exec,
    boundedExec: async (cmd) =>
      cmd.startsWith("python3 -m pytest") ? { code: 127, output: "python3: No module named pytest" } : { code: 0, output: "1 passed in 0.01s" },
    log: (l) => said.push(l),
  });
  assert.equal(String(fellBack.runOne), DECLARED);
  assert.ok(said.some((l) => /own single-test command did not hold on tests\/test_health\.py/.test(l)), said.join("\n"));
});

test("the repository's own single-check command is kept, used and recorded; the suite stays declared", async () => {
  const root = repository({ runOne: PLAIN });
  const ran: string[] = [];
  const said: string[] = [];
  const know = await whatWeKnow({
    deps: { repoRoot: root, told: { provision: PROVISION, runOne: PLAIN } } as never,
    worktree: root,
    tep: "TEP-plain",
    space: emptySpace(),
    cut: { id: "cut-1", changeIds: [] } as never,
    resumed: false,
    halted: () => false,
    exec: async (cmd: string, args: string[]) =>
      cmd === "git" && args.includes("ls-files") ? { code: 0, out: "tests/test_health.py\nrun_tests.sh\n" } : { code: 0, out: "" },
    boundedExec: async (cmd) => {
      ran.push(cmd);
      return { code: 0, output: "1 passed in 0.01s" };
    },
    log: (l) => said.push(l),
    defect: () => {},
  });
  assert.ok(know.ok, know.ok ? "" : know.refusal);
  assert.equal(String(know.runOne), PLAIN, "single checks run with the plain runner");
  assert.equal(String(know.suite), "./run_tests.sh", "the whole suite runs as declared");
  assert.ok(ran.includes("python3 -m pytest -q -p no:cacheprovider tests/test_health.py"), ran.join("\n"));
  assert.ok(said.some((l) => /installs again on every check/.test(l)), "the log says why");
  assert.equal(factsOf(root)?.runOne, PLAIN, "and the next run reads it again from setup.json");
});
