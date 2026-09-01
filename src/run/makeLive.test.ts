/**
 * The work is made live by whatever the repository declares.
 *
 * Four targets, four mechanisms: a push, a playbook run from another
 * repository, a call into control, a shell script beside the code. Treating
 * those as four cases is what produced a survey function guessing a target's
 * shape from a filename, and a deploy nobody could run from inside the loop.
 *
 * They are one question with four answers, and the answers belong to the
 * repositories. The rules below exist to keep that true: nothing here may
 * know what any of the tools are, and adding tomorrow's must be a line of
 * configuration rather than a change to this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLive } from "./makeLive";

const ok = async () => ({ code: 0, out: "" });

function recorder(fail?: { at: string; out: string }) {
  const ran: { command: string; cwd: string }[] = [];
  return {
    ran,
    invoke: async (command: string, cwd: string) => {
      ran.push({ command, cwd });
      return command === fail?.at ? { code: 1, out: fail.out } : { code: 0, out: "done" };
    },
  };
}

test("it runs what the repository declared, in order, where it said", async () => {
  const r = recorder();
  const went = await makeLive({
    repoRoot: "/repo",
    deploy: { run: ["./scripts/tk_ansible ansible/…/12_deploy_dev.yaml"], in: "/core", at: "https://control.example" },
    invoke: r.invoke,
  });
  assert.equal(went.live, true);
  assert.equal(went.at, "https://control.example");
  assert.deepEqual(r.ran, [
    { command: "./scripts/tk_ansible ansible/…/12_deploy_dev.yaml", cwd: "/core" },
  ], "a component's deploy playbook lives in another repository, and runs there");
});

test("without a place named, it runs in the repository being delivered", async () => {
  const r = recorder();
  await makeLive({ repoRoot: "/repo", deploy: { run: ["bash scripts/deploy.sh"] }, invoke: r.invoke });
  assert.equal(r.ran[0].cwd, "/repo");
});

test("declaring nothing to run means the merge already did it", async () => {
  let called = false;
  const went = await makeLive({
    repoRoot: "/repo",
    deploy: { run: [], at: "https://todo.example" },
    invoke: (async () => ((called = true), { code: 0, out: "" })) as never,
  });
  assert.equal(went.live, true, "an app is live because it was pushed; that is not a failure to deploy");
  assert.equal(went.at, "https://todo.example", "and it still says where to look");
  assert.equal(called, false);
});

test("it stops at the first step that fails, and carries the tool's own words", async () => {
  const r = recorder({ at: "second", out: "fatal: could not reach the cluster" });
  const went = await makeLive({
    repoRoot: "/repo",
    deploy: { run: ["first", "second", "third"] },
    invoke: r.invoke,
  });
  assert.equal(went.live, false);
  assert.deepEqual(r.ran.map((x) => x.command), ["first", "second"],
    "a later step acts on a state nobody intended");
  assert.match(went.detail ?? "", /could not reach the cluster/, "the error, not a paraphrase of it");
  assert.match(went.detail ?? "", /`second` exited 1/);
});

test("nothing here knows what any of the tools are", async () => {
  // The point of the abstraction. Four unrelated mechanisms, one code path,
  // and a fifth invented on the spot works exactly as well.
  for (const command of [
    "git push",
    "./scripts/tk_ansible ansible/40_thinkube/core/thinkube-control/12_deploy_dev.yaml",
    "curl -XPOST https://control.example/api/v1/templates/deploy",
    "bash scripts/deploy.sh",
    "terraform apply -auto-approve",
    "helm upgrade --install thing ./chart",
  ]) {
    const r = recorder();
    const went = await makeLive({ repoRoot: "/repo", deploy: { run: [command] }, invoke: r.invoke });
    assert.equal(went.live, true, command);
    assert.deepEqual(r.ran[0].command, command);
  }
});

test("what it says while working names the step, so a person can follow it", async () => {
  const said: string[] = [];
  await makeLive({
    repoRoot: "/repo",
    deploy: { run: ["bash scripts/deploy.sh"], at: "https://x.example" },
    invoke: ok as never,
    log: (l) => said.push(l),
  });
  assert.match(said[0], /bash scripts\/deploy\.sh/);
  assert.match(said[said.length - 1], /live at https:\/\/x\.example/);
});
