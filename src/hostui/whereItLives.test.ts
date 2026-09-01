/**
 * A new application records where it will be seen, in its own file.
 *
 * `thinkube.yaml` grew a `deploy` block and nothing ever wrote one, so every
 * repository was left to a filesystem guess about how it reaches production
 * — a guess that is cached, never shown, and decides what happens after an
 * accept. Creation is the one moment somebody knows the answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sayWhereItLives } from "./templateCore";

function repo(yaml?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-where-"));
  if (yaml !== undefined) fs.writeFileSync(path.join(dir, "thinkube.yaml"), yaml);
  return dir;
}
const CLONE = "https://user:pw@git.thinkube.com/thinkube-deployments/ledger.git";

test("the address follows from the forge it was made on, not from a guess", () => {
  const dir = repo("apiVersion: thinkube.io/v1\nspec:\n  deployment:\n    type: app\n");
  assert.equal(sayWhereItLives(dir, "ledger", CLONE), "https://ledger.thinkube.com");
  const after = fs.readFileSync(path.join(dir, "thinkube.yaml"), "utf8");
  assert.match(after, /deploy:/);
  assert.match(after, /at: https:\/\/ledger\.thinkube\.com/);
});

test("a template's own comments survive the edit", () => {
  // Losing them to a machine's edit is damage nobody notices until they go
  // looking for the explanation that used to be there.
  const dir = repo(
    "# what this app is, and why it is shaped this way\napiVersion: thinkube.io/v1\nspec:\n  # one container, on purpose\n  deployment:\n    type: app\n",
  );
  sayWhereItLives(dir, "ledger", CLONE);
  const after = fs.readFileSync(path.join(dir, "thinkube.yaml"), "utf8");
  assert.match(after, /# what this app is, and why it is shaped this way/);
  assert.match(after, /# one container, on purpose/);
});

test("a repository that already says how it deploys is left alone", () => {
  const said = "spec:\n  deploy:\n    run: bash scripts/deploy.sh\n";
  const dir = repo(said);
  assert.equal(sayWhereItLives(dir, "ledger", CLONE), undefined, "its own answer beats a derived one");
  assert.equal(fs.readFileSync(path.join(dir, "thinkube.yaml"), "utf8"), said);
});

test("nothing is invented when there is nothing to write into", () => {
  assert.equal(sayWhereItLives(repo(), "ledger", CLONE), undefined, "no thinkube.yaml, no claim");
  assert.equal(
    sayWhereItLives(repo("spec: {}\n"), "ledger", "git@github.com:someone/ledger.git"),
    undefined,
    "a clone URL with no platform domain in it says nothing about where this lives",
  );
});
