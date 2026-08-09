/**
 * The guarantee this product ran without: two units that write the same
 * file are never dispatched at the same moment. The engine always had it;
 * nothing called it, and merging by shared file was standing in for it at
 * the cost of one enormous worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontier } from "./frontier";
import type { SchedUnit } from "../engine/core/dag";

const unit = (id: string, footprint: string[], requires: string[] = []): SchedUnit =>
  ({ id, slice: id.split("#")[0], footprint, requires, shape: "serial" }) as SchedUnit;

const all = (pending: string[]) => ({
  pending: new Set(pending),
  done: new Set<string>(),
  failed: new Set<string>(),
  running: [] as string[],
});

test("two units writing the same file are never started together", () => {
  const dag = [unit("a", ["docs/page.adoc"]), unit("b", ["docs/page.adoc"]), unit("c", ["src/x.ts"])];
  const ready = frontier(dag, all(["a", "b", "c"])).map((u) => u.id);
  assert.equal(ready.filter((id) => id === "a" || id === "b").length, 1, "only one writer of the page");
  assert.ok(ready.includes("c"), "an untouched file runs alongside");
});

test("a unit whose file is being written right now waits", () => {
  const dag = [unit("a", ["docs/page.adoc"]), unit("c", ["src/x.ts"])];
  const ready = frontier(dag, { ...all(["a", "c"]), running: ["docs/page.adoc"] }).map((u) => u.id);
  assert.deepEqual(ready, ["c"]);
});

test("the one that waited runs as soon as the file is free", () => {
  const dag = [unit("a", ["docs/page.adoc"]), unit("b", ["docs/page.adoc"])];
  const first = frontier(dag, all(["a", "b"]))[0].id;
  const second = frontier(dag, {
    pending: new Set([first === "a" ? "b" : "a"]),
    done: new Set([first]),
    failed: new Set(),
    running: [],
  }).map((u) => u.id);
  assert.deepEqual(second, [first === "a" ? "b" : "a"], "nothing is starved — it is a queue, not a veto");
});

test("dependencies still hold, and work waiting on a failure never runs", () => {
  const dag = [unit("prod", ["src/a.ts"]), unit("cons", ["src/b.ts"], ["prod"])];
  assert.deepEqual(frontier(dag, all(["prod", "cons"])).map((u) => u.id), ["prod"]);
  assert.deepEqual(
    frontier(dag, { pending: new Set(["cons"]), done: new Set(), failed: new Set(["prod"]), running: [] }),
    [],
    "a consumer of failed work is not dispatched",
  );
  assert.deepEqual(
    frontier(dag, { pending: new Set(["cons"]), done: new Set(["prod"]), failed: new Set(), running: [] }).map(
      (u) => u.id,
    ),
    ["cons"],
  );
});
