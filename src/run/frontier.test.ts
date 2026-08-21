/**
 * The guarantee this product ran without: two units that write the same
 * file are never dispatched at the same moment. The engine always had it;
 * nothing called it, and merging by shared file was standing in for it at
 * the cost of one enormous worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontier, othersCanLand } from "./frontier";
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

test("REGRESSION (v2.0.134): nobody waits on a unit that is waiting — three units slept two hours on each other", () => {
  // What the run did: SL-1, SL-4 and SL-5 each waited for files owned by
  // SL-2, SL-3 and SL-8 — which were queued behind those very units. Every
  // one of them was "pending", so every one of them kept waiting.
  const dag = [
    unit("SL-1#eu-0", ["src/a.ts"]),
    unit("SL-4#eu-0", ["src/b.ts"]),
    unit("SL-2#eu-0", ["src/c.ts"], ["SL-1#eu-0"]),
    unit("SL-3#eu-0", ["src/d.ts"], ["SL-4#eu-0"]),
  ];
  const st = (waiting: string[]) => ({ done: new Set<string>(), failed: new Set<string>(), waiting: new Set(waiting) });
  assert.equal(othersCanLand(dag, "SL-1", st(["SL-1#eu-0"])), true, "SL-4 is awake and can still land");
  assert.equal(
    othersCanLand(dag, "SL-1", st(["SL-1#eu-0", "SL-4#eu-0"])),
    false,
    "both are asleep and everything else is queued behind them — waiting longer changes nothing",
  );
  assert.equal(
    othersCanLand(dag, "SL-1", { done: new Set(), failed: new Set(["SL-4#eu-0"]), waiting: new Set(["SL-1#eu-0"]) }),
    false,
    "a consumer of failed work lands nothing either",
  );
  assert.equal(
    othersCanLand(dag, "SL-1", { done: new Set(["SL-4#eu-0"]), failed: new Set(), waiting: new Set(["SL-1#eu-0"]) }),
    true,
    "but a unit whose producer landed can run, so the wait is worth it",
  );
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
