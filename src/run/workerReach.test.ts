/**
 * A worker never reaches the cluster: not through a command, and not
 * through a credential left in its environment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterReach } from "./toolsAllowed";
import { workerEnv, runnerEnv } from "./oracle";

test("commands that reach the cluster, a database or another machine are refused", () => {
  for (const c of [
    "kubectl get pods -A",
    "nohup kubectl port-forward -n postgres svc/postgresql-official 15432:5432 &",
    "cd /tmp && psql -h 127.0.0.1 -U tkadmin",
    "helm list",
    "ssh tkamd1 ls",
    "podman build .",
  ])
    assert.match(clusterReach(c) ?? "", /refused/, c);
});

test("the tree's own tools are not", () => {
  for (const c of ["npm test", "cd backend && pytest tests/test_tasks.py", "grep -rn kubectl docs/", "cat kubectl.md"])
    assert.equal(clusterReach(c), undefined, c);
});

test("a worker's environment carries no credential and no cluster access", () => {
  process.env.POSTGRES_PASSWORD = "x";
  process.env.ADMIN_PASSWORD = "x";
  process.env.GITHUB_TOKEN = "x";
  process.env.KUBECONFIG = "/x";
  process.env.SOME_API_KEY = "x";
  try {
    const env = workerEnv();
    for (const k of ["POSTGRES_PASSWORD", "ADMIN_PASSWORD", "GITHUB_TOKEN", "KUBECONFIG", "SOME_API_KEY"])
      assert.equal(env[k], undefined, k);
    assert.ok(env.PATH, "the toolchain stays");
    // The runner, which is the engine's own process, gets what CI gives a test container.
    process.env.POSTGRES_USER = "tkadmin";
    const r = runnerEnv();
    assert.equal(r.ADMIN_USERNAME, "tkadmin");
    assert.equal(r.ADMIN_PASSWORD, "x");
  } finally {
    for (const k of ["POSTGRES_PASSWORD", "ADMIN_PASSWORD", "GITHUB_TOKEN", "KUBECONFIG", "SOME_API_KEY", "POSTGRES_USER"]) delete process.env[k];
  }
});
