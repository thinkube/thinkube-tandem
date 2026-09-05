/**
 * What gets judged on the running product, and what the graph says about
 * it before any of it has happened.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pageRoots } from "./live";
import { toDriveOf } from "./observations";
import { seedDrivers } from "./onTheProduct";
import { RunState } from "./state";
import type { Change, Cut, Space } from "../core/schema";

function repoDeclaring(yaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-page-"));
  fs.writeFileSync(path.join(dir, "thinkube.yaml"), yaml);
  return dir;
}

const APP = `apiVersion: thinkube.io/v1
kind: ThinkubeDeployment
spec:
  deployment:
    type: app
  containers:
    - name: backend
      build: ./backend
    - name: frontend
      build: ./frontend
  routes:
    - path: /api
      to: backend
    - path: /
      to: frontend
  deploy:
    at: https://todo.example.com
`;

test("what serves the address is read from the repository's own routes", () => {
  assert.deepEqual(pageRoots(repoDeclaring(APP)), ["frontend"], "the container answering at the root builds the page");
});

test("a repository that declares no route has no page, and nothing is driven", () => {
  const bare = `apiVersion: thinkube.io/v1
kind: ThinkubeDeployment
spec:
  deployment:
    type: none
  parts:
    - root: .
`;
  assert.deepEqual(pageRoots(repoDeclaring(bare)), []);
});

const space = (nodes: Change[]): Space =>
  ({ asks: [{ id: "ask-1", text: "I can see my tasks in order" }], nodes, subjects: [], claims: [], cuts: [], deliveries: [], specs: [] }) as unknown as Space;

const promise = (id: string, where: string, criteria: { id: string; text: string; kind?: "probe" | "assessment"; settledBy?: string }[]): Change =>
  ({
    id,
    sentence: `promise ${id}`,
    serves: ["ask-1"],
    needs: [],
    grounding: { touchpoints: [{ path: where }], stamp: [] },
    acceptance: criteria,
  }) as unknown as Change;

const cut = (ids: string[]): Cut => ({ id: "cut-1", changeIds: ids }) as unknown as Cut;

test("a promise that lands where the page is built is judged on the page — read, settled and off-page work is not", () => {
  const s = space([
    promise("n1", "frontend/src/pages/Tasks.tsx", [
      { id: "c1", text: "the list shows the soonest due date first" },
      { id: "c2", text: "the label reads well in three languages", kind: "assessment" },
      { id: "c3", text: "the image builds in the pipeline", settledBy: "the build" },
    ]),
    promise("n2", "backend/app/api/tasks.py", [{ id: "c4", text: "the endpoint returns tasks in order" }]),
  ]);
  const driven = toDriveOf(s, cut(["n1", "n2"]), ["frontend"]);
  assert.equal(driven.length, 1, "one reviewer, for the one promise about the page");
  assert.deepEqual(
    driven[0].criteria.map((c) => c.id),
    ["c1"],
    "and it judges only what a person can do and see on the page",
  );
  assert.equal(driven[0].ask, "I can see my tasks in order", "and the reviewer is told what was asked");
});

test("a criterion worded for a person watching is driven wherever it lands", () => {
  const s = space([
    promise("n1", "backend/app/api/tasks.py", [
      { id: "c1", text: "in the running app the user sees the count change" },
    ]),
  ]);
  assert.deepEqual(
    toDriveOf(s, cut(["n1"]), []).flatMap((d) => d.criteria.map((c) => c.id)),
    ["c1"],
  );
});

test("the graph carries the reviewers from the first frame, each waiting on the deployment", () => {
  const st = new RunState(() => {});
  const s = space([
    promise("n1", "frontend/src/pages/Tasks.tsx", [
      { id: "c1", text: "the list shows the soonest due date first" },
      { id: "c2", text: "the count matches the cards" },
    ]),
  ]);
  const ids = seedDrivers(st, s, cut(["n1"]), ["frontend"]);
  assert.equal(ids.length, 1, "one reviewer for the promise, not one per criterion");
  for (const id of ids) {
    const u = st.units.get(id)!;
    assert.equal(u.role, "drive");
    assert.equal(u.state, "ready", "it is waiting, and the graph says so before anything runs");
    assert.deepEqual(u.requires, ["live"], "on the deployment");
    assert.equal(u.waits?.[0]?.what, "it can only be judged once the product is answering");
  }
  const what = st.units.get(ids[0])!.what ?? "";
  assert.match(what, /soonest due date/, "and it says what it will judge");
  assert.match(what, /count matches the cards/, "every criterion of the promise, in one session");
});
