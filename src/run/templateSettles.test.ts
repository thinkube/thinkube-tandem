/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A template's promises settled after the merge are answered by deploying
 * it: the declared deploy runs for the merged commit, and its health path
 * is asked. Live and answering is green; a deploy that fails is red in its
 * own words; a template that declares no deploy leaves them pending, and
 * says why — nothing is known about the work from that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { settleTemplateAfterAccept } from "./harvest";
import type { Delivery } from "../core/schema";

const HEAD = "b".repeat(40);

function repo(deploy = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-settle-"));
  fs.writeFileSync(
    path.join(root, "thinkube.yaml"),
    [
      "metadata:",
      '  version: "0.1.0"',
      "spec:",
      "  containers:",
      "    - name: svc",
      "      build: .",
      "      health: /health",
      ...(deploy ? ["  deploy:", "    run: ./deploy.sh", "    at: https://svc.example.com"] : []),
    ].join("\n"),
  );
  return root;
}

const accepted = (): Delivery =>
  ({
    id: "delivery-1",
    cutId: "cut-1",
    branch: "b",
    acceptedAt: "2026-10-15T10:00:00.000Z",
    proofs: [
      { kind: "probe", label: "segments keep their markup", verdict: "green" },
      {
        kind: "staged",
        label: "the deployed service answers /segments",
        verdict: "pending",
        settledBy: "a validation deployment of the template through thinkube-control",
        criterionId: "c1",
      },
    ],
  }) as never;

const exec = async (_cmd: string, args: string[]) =>
  args[2] === "rev-parse" ? { code: 0, out: `${HEAD}\n` } : { code: 0, out: "" };

async function settle(root: string, o: { deployFails?: string } = {}) {
  const updates: { d: Delivery; note: string }[] = [];
  const ran: { command: string; env?: Record<string, string> }[] = [];
  const went = await settleTemplateAfterAccept({
    repoRoot: root,
    delivery: accepted(),
    exec,
    invoke: async (command, _cwd, env) => {
      ran.push({ command, ...(env ? { env } : {}) });
      return o.deployFails ? { code: 1, out: o.deployFails } : { code: 0, out: "deployed" };
    },
    http: async () => new Response("ok", { status: 200 }),
    control: () => ({ base: "https://control.example.com", token: "tok" }),
    wait: async () => {},
    update: (d, note) => updates.push({ d, note }),
    log: () => {},
    now: () => "2026-10-15T11:00:00.000Z",
  });
  return { went, updates, ran, d: updates.at(-1)!.d };
}

test("pending turns green when the deploy goes live and its health path answers", async () => {
  const root = repo();
  const { went, d, ran, updates } = await settle(root);
  assert.deepEqual(went, { live: true, at: "https://svc.example.com" });
  assert.equal(ran[0].command, "./deploy.sh");
  assert.equal(ran[0].env?.THINKUBE_CONTROL_URL, "https://control.example.com");
  assert.equal(ran[0].env?.THINKUBE_API_TOKEN, "tok");
  const p = d.proofs.find((x) => x.criterionId === "c1")!;
  assert.equal(p.verdict, "green");
  assert.match(p.ref ?? "", /validation deployment through thinkube-control: it went live at https:\/\/svc\.example\.com and https:\/\/svc\.example\.com\/health answered/);
  assert.equal(d.proofs[0].verdict, "green", "a proof settled in the run is left as it was");
  assert.deepEqual(d.afterMerge, { at: "2026-10-15T11:00:00.000Z", outcome: "held", said: "a validation deployment through thinkube-control" });
  assert.match(updates.at(-1)!.note, /promises settled after the merge are answered/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".tandem", "setup.json"), "utf8")).deployedAt, HEAD, "the merged commit is recorded as deployed");
});

test("pending turns red, in the deploy's own words, when the deploy fails", async () => {
  const { went, d } = await settle(repo(), { deployFails: "Error: template tkt-svc has no release v0.1.0" });
  assert.deepEqual(went, { live: false });
  const p = d.proofs.find((x) => x.criterionId === "c1")!;
  assert.equal(p.verdict, "red");
  assert.match(p.ref ?? "", /has no release v0\.1\.0/);
  assert.equal(d.afterMerge?.outcome, "broke");
  assert.match(d.afterMerge?.detail ?? "", /`\.\/deploy\.sh` exited 1/);
});

test("a template that declares no deploy leaves its promises pending, and the outcome unjudged", async () => {
  const { d, ran } = await settle(repo(false));
  assert.equal(ran.length, 0);
  const p = d.proofs.find((x) => x.criterionId === "c1")!;
  assert.equal(p.verdict, "pending");
  assert.match(p.ref ?? "", /^still pending — thinkube\.yaml declares no spec\.deploy/);
  assert.equal(d.afterMerge?.outcome, "unjudged");
});
