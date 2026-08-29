/**
 * A cut that changes the rules is judged by its own rules.
 *
 * Tandem developing Tandem is self-hosting. The judging rules run in
 * whatever process started the run, loaded from the checkout — which is on
 * another branch. So a cut correcting a judging rule was judged by the
 * rule it corrects, failed for exactly the reason it fixed, and could
 * never be delivered. It cost a whole plan: seventeen promises came back
 * unkept, both fixes already on the branch, neither visible to the judge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { judgingItself, repositoryOf, ruleFromTreeUnderTest } from "./selfHosted";

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "self-"));
  execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  execFileSync("git", ["-C", root, "add", "."], { stdio: "ignore" });
  execFileSync(
    "git",
    ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"],
    { stdio: "ignore" },
  );
  return root;
}

test("a worktree and the checkout it was cut from are one repository", () => {
  const root = repo();
  const wt = path.join(os.tmpdir(), `self-wt-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "--detach", wt], { stdio: "ignore" });
  assert.equal(repositoryOf(wt), repositoryOf(root), "same repository, different branches");
  assert.equal(judgingItself(wt, root), true, "judging its own machinery");
});

test("judging somebody else's project is not self-hosting", () => {
  assert.equal(judgingItself(repo(), repo()), false);
});

test("the branch's own rule is used when the branch defines it", async () => {
  const root = repo();
  const wt = path.join(os.tmpdir(), `self-wt2-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "--detach", wt], { stdio: "ignore" });
  fs.mkdirSync(path.join(wt, "out", "run"), { recursive: true });
  fs.writeFileSync(
    path.join(wt, "out", "run", "criteria.js"),
    "exports.criterionMapOf = () => new Map([['from', 'the branch']]);\n",
  );

  const rule = await ruleFromTreeUnderTest({
    worktree: wt,
    builtAs: "out/run/criteria.js",
    name: "criterionMapOf",
    running: () => new Map([["from", "the checkout"]]),
    rulesAt: root,
    log: () => {},
  });
  assert.equal(rule.ok, true);
  assert.equal((rule.ok && (rule.rule() as Map<string, string>).get("from")) || "", "the branch");
});

test("an unbuilt tree refuses to judge rather than judging by the old rule", async () => {
  const root = repo();
  const wt = path.join(os.tmpdir(), `self-wt3-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "--detach", wt], { stdio: "ignore" });
  let said = "";
  const rule = await ruleFromTreeUnderTest({
    worktree: wt,
    builtAs: "out/run/criteria.js",
    name: "criterionMapOf",
    running: () => "the checkout's",
    rulesAt: root,
    log: (l) => (said = l),
  });
  assert.equal(rule.ok, false, "judging by the rule this cut corrects is the defect, not the remedy");
  assert.match((rule as { reason: string }).reason, /not built in the tree under test/);
  assert.equal(said, "", "nothing is quietly logged and carried on with");
});

test("another project's tree never has its rules loaded", async () => {
  const theirs = repo();
  fs.mkdirSync(path.join(theirs, "out", "run"), { recursive: true });
  fs.writeFileSync(path.join(theirs, "out", "run", "criteria.js"), "exports.criterionMapOf = () => 'theirs';\n");
  const rule = await ruleFromTreeUnderTest({
    worktree: theirs,
    builtAs: "out/run/criteria.js",
    name: "criterionMapOf",
    running: () => "ours",
    // The rules live somewhere else entirely: another project's tree.
    rulesAt: repo(),
    log: () => {},
  });
  assert.equal(rule.ok && rule.rule(), "ours", "only a self-hosting run reads its rules from the tree it judges");
});
