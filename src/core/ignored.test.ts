/**
 * A walk skips what the repository says it did not write.
 *
 * It used to skip a list of names — node_modules, dist, target, .venv —
 * which is a list of the ecosystems somebody thought of. A project whose
 * output lands anywhere else had its generated files walked as if they
 * were source, and a project using a name nobody listed paid for it on
 * every walk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ignoredFor, ignoredNames, worthWalking } from "./ignored";

/** A project whose output goes somewhere no list would have guessed. */
function projectIgnoring(...ignores: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "walk-"));
  execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
  fs.writeFileSync(path.join(root, ".gitignore"), ignores.map((i) => `${i}/`).join("\n") + "\n");
  fs.writeFileSync(path.join(root, "main.go"), "package main\n");
  for (const d of [...ignores, "internal"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const d of [...ignores, "internal"])
    fs.writeFileSync(path.join(root, d, "f.txt"), "x\n");
  execFileSync("git", ["-C", root, "add", "-A"], { stdio: "ignore" });
  execFileSync(
    "git",
    ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"],
    { stdio: "ignore" },
  );
  return root;
}

test("a Go project's own ignore rules name what to skip", () => {
  const root = projectIgnoring("bin", "gen");
  const ignored = ignoredNames(root);
  assert.ok(ignored.has("bin"), `got [${[...ignored].join(", ")}]`);
  assert.ok(ignored.has("gen"));
  assert.equal(worthWalking("bin", ignored), false, "generated output is not walked");
  assert.equal(worthWalking("internal", ignored), true, "the project's own source is");
});

test("a directory the list would have missed is skipped anyway", () => {
  // No list ever contained "artefacts". The repository says it, so it counts.
  const root = projectIgnoring("artefacts");
  const ignored = ignoredNames(root);
  assert.equal(worthWalking("artefacts", ignored), false);
});

test("a directory the list contained is walked when the project keeps it", () => {
  // A project that COMMITS its vendor directory authors it, so it is source.
  const root = projectIgnoring("bin");
  fs.mkdirSync(path.join(root, "vendor"), { recursive: true });
  fs.writeFileSync(path.join(root, "vendor", "dep.go"), "package dep\n");
  const ignored = ignoredNames(root);
  assert.equal(worthWalking("vendor", ignored), true, "committed vendor code is the project's own");
});

test("the git directory is never walked, whatever the repository says", () => {
  assert.equal(worthWalking(".git", new Set()), false);
});

test("somewhere that is not a repository skips nothing", () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "plain-"));
  assert.deepEqual([...ignoredNames(plain)], []);
});

/**
 * A directory that merely CONTAINS something ignored is still source.
 *
 * Git reports the ignore as a path — `webview/map/node_modules/`. Storing
 * its first segment recorded `webview`, so every walk that asks "may I
 * step in here" was told no: the nested part of this repository went
 * unseen by the survey, and a sub-project's card or a documentation root
 * under such a directory would go the same way.
 */
test("an ignored path does not make its parent unwalkable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nested-ignore-"));
  execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
  fs.mkdirSync(path.join(root, "webview", "map", "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(root, "webview", "map", "node_modules", "dep.js"), "");
  fs.writeFileSync(path.join(root, "webview", "map", "package.json"), "{}");
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");

  const skip = ignoredFor(root);
  assert.equal(worthWalking("webview", skip), true, "the parent of an ignored directory is source");
  assert.equal(worthWalking("node_modules", skip), false, "and the ignored one is skipped at any depth");
});
