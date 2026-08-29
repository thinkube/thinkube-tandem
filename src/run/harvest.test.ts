/**
 * The verdicts a merge set in motion come home, and machine trouble on the
 * way is never one of them.
 *
 * The pipeline's answers are pull-only — control reads the Argo Workflow
 * objects, nothing reports back — so the harvest reads control's own API,
 * with the token the deployer installs for exactly this kind of call, at
 * the URL the repository's own remote implies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attest,
  controlUrlOf,
  readPipeline,
  runClusterValidation,
  stampPending,
  validateComponentsAfterAccept,
} from "./harvest";
import type { Delivery } from "../core/schema";

const delivered = (): Delivery =>
  ({
    id: "delivery-1",
    cutId: "cut-1",
    branch: "b",
    proofs: [
      { kind: "probe", label: "listTodos() returns the rows", verdict: "green" },
      {
        kind: "staged",
        label: "GET /api/todos returns 200 on the deployed app",
        verdict: "pending",
        settledBy: "the app's build pipeline",
        criterionId: "c1",
      },
    ],
  }) as never;

test("the control URL comes from the repository's own remote, token and all stripped", () => {
  assert.equal(
    controlUrlOf("https://tkadmin:374bb353@git.thinkube.com/thinkube-deployments/todo.git"),
    "https://control.thinkube.com",
  );
  assert.equal(controlUrlOf("git@github.com:kubexlat/tkt-aligner.git"), undefined, "not a platform remote");
});

test("a settled pipeline stamps the pending proofs; an unreachable one stamps nothing", async () => {
  const reading = await readPipeline({
    controlUrl: "https://control.example",
    app: "todo",
    since: "2026-08-29T18:00:00Z",
    token: "t",
    http: async (url) =>
      url.endsWith("/pipelines")
        ? { pipelines: [{ name: "todo-build-x", appName: "todo", startedAt: "2026-08-29T18:05:00Z" }] }
        : { status: "Failed", stages: [{ name: "test-backend", status: "Failed" }, { name: "build-backend", status: "Omitted" }] },
  });
  assert.equal(reading.settled, true);

  const stamped = stampPending(delivered(), reading);
  assert.equal(stamped.proofs[1].verdict, "red", "the pipeline's own answer, brought home");
  assert.match(stamped.proofs[1].ref ?? "", /test-backend failed/);
  assert.equal(stamped.proofs[0].verdict, "green", "proofs already settled here are untouched");

  const unreachable = stampPending(delivered(), {
    settled: false,
    stages: [],
    unreachable: "GET … → 503",
  });
  assert.equal(unreachable.proofs[1].verdict, "pending", "not being able to look is not an answer");
  assert.match(unreachable.proofs[1].ref ?? "", /still pending/);
});

test("an old pipeline run never answers for this accept", async () => {
  const reading = await readPipeline({
    controlUrl: "https://control.example",
    app: "todo",
    since: "2026-08-29T18:00:00Z",
    token: "t",
    // The only run control knows started before the accept — last week's.
    http: async () => ({ pipelines: [{ name: "old", appName: "todo", startedAt: "2026-08-20T00:00:00Z" }] }),
  });
  assert.equal(reading.settled, false);
  assert.match(reading.unreachable ?? "", /no pipeline for todo since/);
});

test("cluster validation reads the playbook's own recap, and only a validation playbook runs", async () => {
  const green = await runClusterValidation({
    repoRoot: "/repo",
    playbook: "ansible/40_thinkube/core/keycloak/18_test.yaml",
    exec: async () => ({ code: 0, out: "PLAY RECAP\ntkamd1 : ok=29 changed=0 unreachable=0 failed=0\n" }),
  });
  assert.equal(green.verdict, "green");

  const red = await runClusterValidation({
    repoRoot: "/repo",
    playbook: "ansible/40_thinkube/core/keycloak/18_test.yaml",
    exec: async () => ({ code: 2, out: "PLAY RECAP\ntkamd1 : ok=12 failed=3\n" }),
  });
  assert.equal(red.verdict, "red");

  const refused = await runClusterValidation({
    repoRoot: "/repo",
    playbook: "ansible/40_thinkube/core/keycloak/19_rollback.yaml",
    exec: async () => ({ code: 0, out: "failed=0" }),
  });
  assert.equal(refused.verdict, "unjudged", "a rollback is never run in validation's name");

  const silent = await runClusterValidation({
    repoRoot: "/repo",
    playbook: "ansible/x/18_test.yaml",
    exec: async () => ({ code: 1, out: "ssh: connect to host tkamd1: no route" }),
  });
  assert.equal(silent.verdict, "unjudged", "no recap means nothing was judged — never a red");
});

test("an attestation closes the one pending proof it names, in the person's words", () => {
  const d = delivered();
  const done = attest(d, "c1", { held: true, note: "installed on hp-01, wizard completed", by: "cmxela", at: "now" });
  assert.ok(!("refused" in done));
  assert.equal((done as Delivery).proofs[1].verdict, "green");
  assert.match((done as Delivery).proofs[1].ref ?? "", /attested by cmxela.*hp-01/);

  const missing = attest(d, "c9", { held: true, by: "cmxela", at: "now" });
  assert.ok("refused" in missing, "attesting nothing pending is refused, not invented");
});

/**
 * A component proves itself on the live cluster, and only there.
 *
 * A playbook repository proves nothing in a worktree: what "deployed and
 * working" means is written in the component's own 18_test.yaml, against
 * the running cluster. Tandem runs that one itself after the delivery is
 * accepted — and nothing else in the component's directory, however the
 * files were named.
 */
test("the component whose code the cut touched is the one validated", async () => {
  const ran: string[] = [];
  const d = {
    ...delivered(),
    proofs: [
      {
        kind: "staged" as const,
        label: "keycloak answers on its route",
        verdict: "pending" as const,
        settledBy: "the component's 18_test.yaml on the live cluster",
        criterionId: "c1",
      },
    ],
  };
  let last: Delivery = d as Delivery;
  await validateComponentsAfterAccept({
    repoRoot: "/repo",
    landed: ["ansible/40_thinkube/core/keycloak/10_deploy.yaml"],
    delivery: d as Delivery,
    update: (x) => (last = x),
    log: () => {},
    findPlaybook: (_r, dir) =>
      dir.endsWith("keycloak") ? "ansible/40_thinkube/core/keycloak/18_test.yaml" : undefined,
    run: async (_c, args) => {
      ran.push(args[0]);
      return { code: 0, out: "PLAY RECAP\ntkamd1 : ok=29 failed=0\n" };
    },
  });

  assert.deepEqual(ran, ["ansible/40_thinkube/core/keycloak/18_test.yaml"], "its own validation, nothing else");
  assert.equal(last.proofs[0].verdict, "green");
  assert.match(last.proofs[0].ref ?? "", /validated on the live cluster/);
});

test("a cut that touches no component leaves its promises pending, and says why", async () => {
  const said: string[] = [];
  let touched = false;
  await validateComponentsAfterAccept({
    repoRoot: "/repo",
    landed: ["scripts/tk_ansible"],
    delivery: {
      ...delivered(),
      proofs: [
        { kind: "staged" as const, label: "x", verdict: "pending" as const, settledBy: "the cluster", criterionId: "c1" },
      ],
    },
    update: () => (touched = true),
    log: (l) => said.push(l),
    findPlaybook: () => undefined,
    run: async () => ({ code: 0, out: "failed=0" }),
  });
  assert.equal(touched, false, "nothing is stamped from a validation that never ran");
  assert.match(said.join(" "), /a fact about this repository, not about the work/);
});
