/**
 * The platform's own declaration, read at the moment of use.
 *
 * `thinkube.yaml` is authored truth: what the containers are, how each is
 * tested by the build, and — since the deploy abstraction — how the
 * repository is made live. Tandem reads it and never copies it, because a
 * copy drifts from the original and then the two contradict.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { thinkubeDeclaration } from "./thinkubeYaml";

/** A repository whose only content is the declaration under test. */
function tmp(yaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-decl-"));
  fs.writeFileSync(path.join(dir, "thinkube.yaml"), yaml);
  return dir;
}

test("a repository with no declaration makes none", () => {
  assert.equal(thinkubeDeclaration(fs.mkdtempSync(path.join(os.tmpdir(), "tk-none-"))), undefined);
});

test("a file that exists and does not parse is a finding, never a silent absence", () => {
  const r = thinkubeDeclaration(tmp("spec:\n  containers:\n   - name: [unclosed\n"));
  assert.ok(r && "unreadable" in r, "a broken declaration must not read as no declaration");
});


/**
 * A repository says how it is made live, in its own file.
 *
 * The declaration is a list of commands rather than a named method, because
 * a method name is a branch waiting to be written and the platform keeps
 * growing ways to deploy. One command or several, written either way.
 */
test("the deploy declaration is read whole", () => {
  const dir = tmp(`apiVersion: thinkube.io/v1
kind: ThinkubeDeployment
spec:
  deployment:
    type: component
  deploy:
    run:
      - "./scripts/tk_ansible ansible/40_thinkube/core/thinkube-control/12_deploy_dev.yaml"
    in: /home/thinkube/thinkube-platform/core/thinkube
    at: https://control.thinkube.com
`);
  const r = thinkubeDeclaration(dir);
  assert.ok(r && "declared" in r);
  assert.deepEqual(r.declared.deploy, {
    run: ["./scripts/tk_ansible ansible/40_thinkube/core/thinkube-control/12_deploy_dev.yaml"],
    in: "/home/thinkube/thinkube-platform/core/thinkube",
    at: "https://control.thinkube.com",
  });
});

test("one command needs no list", () => {
  const dir = tmp(`spec:\n  deploy:\n    run: bash scripts/deploy.sh\n`);
  const r = thinkubeDeclaration(dir);
  assert.ok(r && "declared" in r);
  assert.deepEqual(r.declared.deploy?.run, ["bash scripts/deploy.sh"]);
});

test("an app declares where it lives without declaring how — the push already did it", () => {
  const dir = tmp(`spec:\n  deploy:\n    at: https://todo.thinkube.com\n`);
  const r = thinkubeDeclaration(dir);
  assert.ok(r && "declared" in r);
  assert.deepEqual(r.declared.deploy, { run: [], at: "https://todo.thinkube.com" });
});

test("a repository saying nothing about deploying is left exactly as it was", () => {
  const dir = tmp(`spec:\n  deployment:\n    type: app\n`);
  const r = thinkubeDeclaration(dir);
  assert.ok(r && "declared" in r);
  assert.equal(r.declared.deploy, undefined, "no declaration is not an empty one");
});
