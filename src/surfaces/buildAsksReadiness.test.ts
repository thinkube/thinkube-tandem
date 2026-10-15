/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build asks whether the repository is ready before it signs.
 *
 * A run signed against a repository whose setup does not hold, or whose
 * deploy is not declared, is refused or misbehaves for that alone, after
 * the press that cannot be undone. So the press asks first, and refuses
 * with every item that is not ready, in words that say what to fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlow } from "./buildFlow";
import { emptySpace, Space } from "../core/schema";
import type { Readiness } from "../run/readiness";

function space(): Space {
  return {
    ...emptySpace(),
    asks: [{ id: "a1", text: "one", at: "" }] as Space["asks"],
    subjects: [{ id: "subject-1", name: "the list", from: ["a1"] }],
    claims: [{ id: "c1", subjectId: "subject-1", text: "sorted", fromAsk: "a1" }],
    nodes: [
      { id: "n1", sentence: "the list comes back sorted", serves: ["subject-1"], servesClaim: "c1", needs: [], acceptance: [] },
    ] as unknown as Space["nodes"],
    specs: [{ id: "s1", name: "see what to do", subjectIds: ["subject-1"] }],
  };
}

function session(readiness?: () => Promise<Readiness[]>) {
  const s = {
    space: space(),
    activity: undefined,
    signed: false,
    cutNodeIds: new Set<string>(),
    cutSpecId: undefined as string | undefined,
    groundingView: () => [],
    changed: () => {},
    signCut: () => {
      s.signed = true;
      return { ok: true };
    },
    deps: { now: () => "2026-10-15T00:00:00.000Z", ...(readiness ? { readiness } : {}) },
  };
  return s;
}

const answer = (items: Readiness["items"]): Readiness[] => [
  { repoRoot: "/repo", head: "c".repeat(40), at: "2026-10-15T00:00:00.000Z", items },
];

test("Build refuses, naming every item that is not ready, and signs nothing", async () => {
  const s = session(async () =>
    answer([
      { name: "setup", ready: true, say: "the setup holds" },
      { name: "deploy declared", ready: false, say: "thinkube.yaml spec.deploy does not declare `run` — declare it" },
      { name: "release", ready: false, say: "origin has no vMAJOR.MINOR.PATCH tag — tag the release v0.1.0" },
    ]),
  );
  const r = await buildFlow(s as never, "s1");
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /^not ready to sign — /);
  assert.match(r.reason ?? "", /deploy declared: thinkube\.yaml spec\.deploy does not declare `run`/);
  assert.match(r.reason ?? "", /release: origin has no vMAJOR\.MINOR\.PATCH tag/);
  assert.doesNotMatch(r.reason ?? "", /setup/, "a ready item is not a reason");
  assert.equal(s.signed, false);
});

test("Build signs when every item is ready", async () => {
  const s = session(async () => answer([{ name: "setup", ready: true, say: "the setup holds" }]));
  const r = await buildFlow(s as never, "s1");
  assert.equal(r.ok, true, r.reason);
  assert.equal(s.signed, true);
});

test("Build refuses when the readiness check cannot run, or the session has none", async () => {
  const failing = session(async () => {
    throw new Error("git could not name HEAD in /repo");
  });
  const r = await buildFlow(failing as never, "s1");
  assert.match(r.reason ?? "", /the readiness check could not run: git could not name HEAD/);
  assert.equal(failing.signed, false);

  const without = session();
  const r2 = await buildFlow(without as never, "s1");
  assert.match(r2.reason ?? "", /no readiness check/);
  assert.equal(without.signed, false);
});
