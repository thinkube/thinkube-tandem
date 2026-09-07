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
import { judgeOnTheProduct, seedDrivers } from "./onTheProduct";
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

test("with no way in, no reviewer is started and every criterion comes back unjudged", async () => {
  // Driving reviewers that cannot sign in spends minutes to write the same
  // lockout on every criterion; a criterion nobody reached is unjudged,
  // never a verdict on the work.
  const st = new RunState(() => {});
  const s = space([
    promise("n1", "frontend/src/pages/Tasks.tsx", [
      { id: "c1", text: "the list shows the soonest due date first" },
      { id: "c2", text: "the count matches the cards" },
    ]),
  ]);
  const c = cut(["n1"]);
  const said: string[] = [];
  let drove = false;
  const out = await judgeOnTheProduct({
    at: "https://todo.example.com",
    st,
    log: (l) => said.push(l),
    deps: { model: "test" },
    space: s,
    cut: c,
    pageRoots: ["frontend"],
    // No store directory, so there is nowhere to keep a session and no way in.
    outcome: {
      delivery: { id: "d1", cutId: "cut-1", branch: "b", proofs: [{ kind: "probe", label: "built", verdict: "green" }] },
    } as never,
    drive: (async () => {
      drove = true;
      return [];
    }) as never,
  });
  assert.equal(drove, false, "no browser is opened when the run already knows the reviewers are locked out");
  assert.ok(said.some((l) => /locked out, so none was started/.test(l)), said.join(" · "));
  const proofs = (out.delivery?.proofs ?? []) as { criterionId?: string; verdict: string; ref?: string }[];
  assert.deepEqual(
    proofs.filter((p) => p.criterionId).map((p) => [p.criterionId, p.verdict]),
    [["c1", "unjudged"], ["c2", "unjudged"]],
    "the promises stay for the person, never counted as failing",
  );
  assert.match(proofs.find((p) => p.criterionId === "c1")?.ref ?? "", /no reviewer could sign in/);
  assert.equal(proofs.find((p) => !p.criterionId)?.verdict, "green", "what was already settled is untouched");
});

test("each reviewer signs in at its own start, so a queued one never inherits a spent token", async () => {
  // Reviewers run a few at a time and the platform's token lasts minutes,
  // so one session minted before any of them starts is already half spent
  // when the last opens its browser — and the sign-on host it would renew
  // at is the one its own origin limit refuses.
  const st = new RunState(() => {});
  const s = space([
    promise("n1", "frontend/a.tsx", [{ id: "c1", text: "the count matches the cards" }]),
    promise("n2", "frontend/b.tsx", [{ id: "c2", text: "the list shows the soonest first" }]),
  ]);
  const here = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-looks-"));
  const signedInto: string[] = [];
  await judgeOnTheProduct({
    at: "https://todo.example.com",
    st,
    log: () => {},
    deps: { model: "test" },
    space: s,
    cut: cut(["n1", "n2"]),
    pageRoots: ["frontend"],
    storeDir: here,
    runId: "run-1",
    outcome: { delivery: { id: "d1", cutId: "cut-1", branch: "b", proofs: [] } } as never,
    signIn: (async (x: { into: string }) => {
      signedInto.push(path.relative(path.join(here, "looks", "run-1"), x.into));
      fs.mkdirSync(path.dirname(x.into), { recursive: true });
      fs.writeFileSync(x.into, "{}");
      return { path: x.into };
    }) as never,
    wayInWorks: (async () => ({ ok: true })) as never,
    open: (async () => ({ url: 'http://localhost:1/mcp', said: [], close: () => undefined })) as never,
    // Like the real driveAll: a browser per reviewer, opened as it starts.
    drive: (async (
      _a: unknown,
      list: { criteria: { id?: string; text: string }[] }[],
      driverIds: string[],
      openOne: (who: string) => Promise<{ close: () => void } | { why: string }>,
    ) => {
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const b = await openOne(driverIds[i]);
        if ("close" in b) b.close();
        out.push(
          list[i].criteria.map((x) => ({
            kind: "assessment",
            label: x.text,
            verdict: "green",
            ...(x.id ? { criterionId: x.id } : {}),
          })),
        );
      }
      return out;
    }) as never,
  });
  assert.deepEqual(
    signedInto.slice(1).sort(),
    ["on-the-product-1/session.json", "on-the-product-2/session.json"],
    `one sign-in each, into that reviewer's own directory: ${signedInto.join(", ")}`,
  );
  assert.equal(signedInto[0], "session.json", "and one up front, to prove the way in works at all");
  fs.rmSync(here, { recursive: true, force: true });
});
