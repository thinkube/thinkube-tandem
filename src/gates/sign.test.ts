/**
 * The sign gate's own drives: what a signature covers, what the person
 * reads before signing, and when a delivery of a many-repository cut may
 * be accepted.
 *
 * Each names the failure it guards: a signature that every commit
 * invalidated, a review that hid where work lands, an accept that merged a
 * third of a promise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptDelivery, signCut, verifyCutSignature } from "./sign";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";
import type { Delivery } from "../core/schema";

/**
 * A cut that spans repositories is one piece of work. Accepting a third of
 * it merges a third of a promise and leaves the rest to memory.
 */
const green = (id: string, cutId: string, branch: string): Delivery => ({
  id,
  cutId,
  branch,
  proofs: [{ kind: "probe", label: "it works", verdict: "green" }],
});

test("recording where a proof lived does not invalidate the signature that authorised it", () => {
  // The run writes a proof anchor onto each criterion when it delivers. If
  // that counted as the promise changing, every second run of a cut would
  // refuse itself — which is exactly what happened the first time the drift
  // check was wired.
  const base = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "greet the user",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns hello" }],
        grounding: { touchpoints: [{ path: "src/greet.ts", planned: true }], stamp: [] },
      },
    ],
  };
  const signed = signCut(base, { id: "cut-1", changeIds: ["n1"] }, "2026-08-22T00:00:00Z", "t");
  assert.ok(signed.ok, signed.ok ? "" : signed.reason);

  const afterDelivery = {
    ...base,
    nodes: base.nodes.map((n) => ({
      ...n,
      acceptance: n.acceptance.map((a) => ({
        ...a,
        proof: { path: "deliveries/TEP-1.json", stamp: [{ root: "/repo", head: "abc", dirty: "" }] },
      })),
    })),
  };
  assert.deepEqual(verifyCutSignature(afterDelivery, signed.cut), { ok: true });

  // But the promise's own words still cannot move under a signature.
  const reworded = {
    ...base,
    nodes: base.nodes.map((n) => ({ ...n, acceptance: [{ id: "c1", text: "greet() returns anything" }] })),
  };
  assert.equal(verifyCutSignature(reworded, signed.cut).ok, false, "a criterion that was reworded is drift");
});

test("a signature survives the repository moving, but not the promise moving", () => {
  const at = (path: string, stamp: string) => ({
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "greet the user",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns hello" }],
        grounding: {
          touchpoints: [{ path, planned: true, evidence: `read at ${stamp}` }],
          stamp: [{ root: "/repo", head: stamp, dirty: "" }],
        },
      },
    ],
  });
  const signed = signCut(at("src/greet.ts", "aaa"), { id: "cut-1", changeIds: ["n1"] }, "2026-08-22T00:00:00Z", "t");
  assert.ok(signed.ok, signed.ok ? "" : signed.reason);

  // The repository moved: a new head, a re-read evidence line. Same promise.
  assert.deepEqual(verifyCutSignature(at("src/greet.ts", "bbb"), signed.cut), { ok: true });

  // The promise now lands somewhere else. That is drift.
  assert.equal(verifyCutSignature(at("src/other.ts", "aaa"), signed.cut).ok, false);
});

test("the cut review says where each promise lands and what cannot be proven", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "the panel opens once per space",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "opening twice reveals the same tab" }],
        grounding: { touchpoints: [{ path: "src/panel.ts", planned: false, scope: "web" }], stamp: [] },
        unverified: [{ text: "it looks right on a small screen", why: "no one can drive a person's eyes" }],
      },
    ],
  };
  const screen = renderCutScreen(space, { id: "cut-1", changeIds: ["n1"] });
  assert.match(screen, /in web/, "the repository each promise lands in is on the page");
  assert.match(screen, /cannot prove these/);
  assert.match(screen, /looks right on a small screen/);
  assert.match(screen, /no one can drive a person's eyes/, "with the reason it cannot be driven");
});

test("a delivery is not accepted while another repository of the same cut is open", () => {
  const web = green("d-web", "cut-1", "tandem/web/TEP-1");
  const api = green("d-api", "cut-1", "tandem/api/TEP-1");
  const r = acceptDelivery(web, "2026-08-22T00:00:00Z", "advisory", [web, api]);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /also lands in 1 other repository/);
  assert.match(r.ok ? "" : r.reason, /tandem\/api\/TEP-1/);
});

test("a delivery is accepted once every repository of its cut is", () => {
  const web = green("d-web", "cut-1", "tandem/web/TEP-1");
  const api = { ...green("d-api", "cut-1", "tandem/api/TEP-1"), acceptedAt: "2026-08-22T00:00:00Z" };
  const r = acceptDelivery(web, "2026-08-22T00:01:00Z", "advisory", [web, api]);
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});

test("a withheld sibling is named as withheld, not merely missing", () => {
  const web = green("d-web", "cut-1", "tandem/web/TEP-1");
  const api = { ...green("d-api", "cut-1", "tandem/api/TEP-1"), withheld: "two promises are not kept" };
  const r = acceptDelivery(web, "2026-08-22T00:00:00Z", "advisory", [web, api]);
  assert.match(r.ok ? "" : r.reason, /withheld/);
});
