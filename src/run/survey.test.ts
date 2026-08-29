/**
 * The survey decides what kind of target a repository is — from evidence,
 * asking nobody — and finds the parts it is made of.
 *
 * The fixtures replicate the real shapes verified on this platform:
 * `apps/todo` (a deployed app: Gitea remote, two containers, CI tests
 * declared per container), `tkt-texplitter` (a template: TemplateManifest
 * + thinkube.yaml, zero tests), the playbook repo (`18_test.yaml` under
 * `ansible/`), the installer (`src-tauri`), and this extension (a nested
 * manifest with its own lockfile).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { downstreamOf, partsOf } from "./survey";
import { thinkubeDeclaration } from "../core/thinkubeYaml";
import { proved, runnerFor } from "./proved";

function repo(remote?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "survey-"));
  execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
  if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote], { stdio: "ignore" });
  return dir;
}

const TODO_YAML = `apiVersion: thinkube.io/v1
kind: ThinkubeDeployment
spec:
  deployment:
    type: app
  containers:
    - name: backend
      build: ./backend
      port: 8000
      test:
        enabled: true
        image: "python-base:3.12-slim"
        command: "./run_tests.sh"
    - name: frontend
      build: ./frontend
      port: 80
      test:
        enabled: true
        image: "node:24-alpine"
        command: "./run_tests.sh"
`;

test("a deployed app is known by its remote, and its parts by its containers", () => {
  const dir = repo("https://tkadmin:token@git.thinkube.com/thinkube-deployments/todo.git");
  fs.writeFileSync(path.join(dir, "thinkube.yaml"), TODO_YAML);
  // The app still carries the template's manifest it was copied from —
  // the remote must decide first, or every app reads as a template.
  fs.writeFileSync(
    path.join(dir, "manifest.yaml"),
    "apiVersion: thinkube.io/v1\nkind: TemplateManifest\nmetadata:\n  name: tkt-webapp-vue-fastapi\n",
  );

  assert.equal(downstreamOf(dir), "gitops-app");
  assert.deepEqual(
    partsOf(dir).map((p) => p.root),
    ["backend", "frontend"],
    "one part per container, rooted at its build context",
  );

  const read = thinkubeDeclaration(dir);
  assert.ok(read && "declared" in read);
  assert.deepEqual(read.declared.containers[0].test, {
    enabled: true,
    command: "./run_tests.sh",
    image: "python-base:3.12-slim",
  });
});

test("a template is known by its manifest kind, whatever its remote is called", () => {
  const dir = repo("git@github.com:kubexlat/tkt-texplitter.git");
  fs.writeFileSync(
    path.join(dir, "manifest.yaml"),
    "apiVersion: thinkube.io/v1\nkind: TemplateManifest\nmetadata:\n  name: tkt-texplitter\n",
  );
  fs.writeFileSync(
    path.join(dir, "thinkube.yaml"),
    "spec:\n  deployment:\n    type: knative\n  containers:\n    - name: texplitter\n      build: .\n      test:\n        enabled: false\n",
  );
  assert.equal(downstreamOf(dir), "template");
  assert.deepEqual(partsOf(dir).map((p) => p.root), ["."], "one container at the root is one part");
});

test("playbooks, packages and plain repositories are told apart by their own marks", () => {
  const playbooks = repo();
  fs.mkdirSync(path.join(playbooks, "ansible", "40_thinkube", "core", "keycloak"), { recursive: true });
  fs.writeFileSync(
    path.join(playbooks, "ansible", "40_thinkube", "core", "keycloak", "18_test.yaml"),
    "- hosts: k8s_control_plane\n",
  );
  assert.equal(downstreamOf(playbooks), "ansible");

  const installer = repo();
  fs.mkdirSync(path.join(installer, "frontend", "src-tauri"), { recursive: true });
  assert.equal(downstreamOf(installer), "package");

  assert.equal(downstreamOf(repo()), "script", "nothing declared means everything happens here");
});

test("a nested manifest with its own lockfile is its own part", () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, "webview", "map"), { recursive: true });
  fs.writeFileSync(path.join(dir, "webview", "map", "package.json"), "{}");
  fs.writeFileSync(path.join(dir, "webview", "map", "package-lock.json"), "{}");
  assert.deepEqual(
    partsOf(dir).map((p) => p.root),
    [".", "webview/map"],
    "two toolchains, two parts — the reason one repo-wide runOne was wrong",
  );
});

test("a thinkube.yaml that exists but does not parse is named, never silently absent", () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "thinkube.yaml"), "spec: [unclosed");
  const read = thinkubeDeclaration(dir);
  assert.ok(read && "unreadable" in read, "a broken declaration is a finding");
  assert.match(read.unreadable, /does not parse/);
  assert.equal(thinkubeDeclaration(repo()), undefined, "and a repo that makes none is undefined");
});

/**
 * A check is run by the runner of the PART that owns it.
 *
 * One repository is often several toolchains — todo is a python backend
 * beside a node frontend, control adds a go proxy. A single repository-wide
 * command ran the wrong runner for every part but one: a frontend check
 * judged by pytest is red for a reason no worker can act on, and that red
 * counted as a promise not kept.
 */
test("each part's checks get that part's own runner, and the rest keep the repository's", () => {
  const wide = proved("node --test <file>", true)!;
  const forCheck = runnerFor(wide, {
    ".": { runOne: "node --test <file>" },
    backend: { runOne: "pytest <file>" },
    "frontend/ui": { runOne: "vitest run <file>" },
  });

  assert.equal(forCheck("backend/app_AC-1.test.py"), "pytest <file>", "the backend's own runner");
  assert.equal(forCheck("frontend/ui/card_AC-2.test.ts"), "vitest run <file>", "the deepest part wins");
  assert.equal(forCheck("src/core/schema_AC-1.test.ts"), wide, "a file no part claims keeps the repository's");
  assert.equal(forCheck("backendish/x.test.ts"), wide, "a name that merely starts the same is not that part");
});

test("a repository with one toolchain is unchanged — no parts, one runner", () => {
  const wide = proved("npm test -- <file>", true)!;
  const forCheck = runnerFor(wide);
  assert.equal(forCheck("anything/at/all.test.ts"), wide);
});
