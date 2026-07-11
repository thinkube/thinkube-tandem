/**
 * sliceFilesExistInRepo — the footprint EXISTENCE gate (2026-07-11).
 *
 * The motivating failure: TEP-1_SP-4's slice footprinted
 * `backend/app/services/templates/service-configmap.yaml.j2`, which exists
 * nowhere — the real file is repo-root `templates/service-configmap.yaml.j2`.
 * The purely lexical containment guard accepted it, workers were fenced onto
 * the phantom path, and three orchestrations burned identically. This gate
 * refuses at creation, with a did-you-mean.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sliceFilesExistInRepo,
  type RepoFileOracle,
} from "./sliceRepoGuard";

const REPO = "/repo";

function oracle(existing: string[]): RepoFileOracle & { listed: number } {
  const o = {
    listed: 0,
    exists: (rel: string) => existing.includes(rel),
    listFiles: () => {
      o.listed++;
      return existing;
    },
  };
  return o;
}

test("every existing footprint path passes", () => {
  const o = oracle(["src/a.ts", "templates/service-configmap.yaml.j2"]);
  const r = sliceFilesExistInRepo(
    REPO,
    ["src/a.ts", "templates/service-configmap.yaml.j2"],
    [],
    o,
  );
  assert.deepEqual(r, { ok: true });
  assert.equal(o.listed, 0, "did-you-mean listing is lazy — not consulted on green");
});

test("a phantom path refuses with a did-you-mean basename match (the TEP-1_SP-4 case)", () => {
  const o = oracle(["templates/service-configmap.yaml.j2", "src/other.ts"]);
  const r = sliceFilesExistInRepo(
    REPO,
    ["backend/app/services/templates/service-configmap.yaml.j2"],
    [],
    o,
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.offending, [
      "backend/app/services/templates/service-configmap.yaml.j2",
    ]);
    assert.match(r.reason, /do not exist/);
    assert.match(r.reason, /did you mean "templates\/service-configmap\.yaml\.j2"\?/);
    assert.match(r.reason, /creates:/);
  }
});

test("a `creates:` entry exempts a not-yet-existing file", () => {
  const o = oracle(["src/a.ts"]);
  const r = sliceFilesExistInRepo(
    REPO,
    ["src/a.ts", "src/new-module.ts"],
    ["src/new-module.ts"],
    o,
  );
  assert.deepEqual(r, { ok: true });
});

test("creates matching is normalization-tolerant (./x vs x)", () => {
  const o = oracle([]);
  const r = sliceFilesExistInRepo(REPO, ["./src/new.ts"], ["src/new.ts"], o);
  assert.deepEqual(r, { ok: true });
});

test("a missing path with no basename match refuses without a suggestion", () => {
  const o = oracle(["src/a.ts"]);
  const r = sliceFilesExistInRepo(REPO, ["docs/nowhere.adoc"], [], o);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /"docs\/nowhere\.adoc"/);
    assert.doesNotMatch(r.reason, /did you mean/);
  }
});

test("multiple missing paths are all named", () => {
  const o = oracle(["real/x.ts"]);
  const r = sliceFilesExistInRepo(REPO, ["a/x.ts", "b/y.ts"], [], o);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.offending, ["a/x.ts", "b/y.ts"]);
    assert.match(r.reason, /did you mean "real\/x\.ts"\?/);
  }
});
