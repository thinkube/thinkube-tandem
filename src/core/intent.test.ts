/**
 * The intent contract: asks verbatim and append-only, edges checked at the
 * door, orphans surfaced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { addAsk, addNode, asksOf, orphanChanges } from "./intent";
import { emptySpace } from "./schema";

test("an ask is stored byte for byte — whitespace, casing, everything", () => {
  const text = "  make the log panel  follow the running step\n(please)  ";
  const r = addAsk(emptySpace(), text, "2026-08-05T17:00:00Z");
  assert.ok(r.ok);
  assert.equal(r.space.asks[0].text, text);
  assert.equal(addAsk(emptySpace(), "   ", "t").ok, false, "empty refused");
});

test("asks are append-only: no API edits an ask, and adding never touches earlier ones", () => {
  let s = emptySpace();
  const first = addAsk(s, "first ask", "t1");
  assert.ok(first.ok);
  s = first.space;
  const snapshot = JSON.stringify(s.asks[0]);
  const second = addAsk(s, "second ask", "t2");
  assert.ok(second.ok);
  assert.equal(JSON.stringify(second.space.asks[0]), snapshot);
  const intentApi = Object.keys(require("./intent") as Record<string, unknown>);
  assert.ok(
    !intentApi.some((k) => /edit|rewrite|update/i.test(k)),
    "the intent API exposes no ask-editing function",
  );
});

test("node edges are checked at the door; orphans are surfaced", () => {
  let s = emptySpace();
  const a = addAsk(s, "an ask", "t");
  assert.ok(a.ok);
  s = a.space;

  const bad = addNode(s, { sentence: "x", serves: ["ask-9"], needs: [], acceptance: [] });
  assert.equal(bad.ok, false, "unknown ask refused");

  const n1 = addNode(s, { sentence: "grounded change", serves: [a.added.id], needs: [], acceptance: [] });
  assert.ok(n1.ok);
  s = n1.space;
  const badNeed = addNode(s, { sentence: "y", serves: [a.added.id], needs: ["node-7"], acceptance: [] });
  assert.equal(badNeed.ok, false, "unknown need refused");

  const orphan = addNode(s, { sentence: "who asked for this?", serves: [], needs: [], acceptance: [] });
  assert.ok(orphan.ok);
  s = orphan.space;
  assert.deepEqual(orphanChanges(s).map((n) => n.sentence), ["who asked for this?"]);
  assert.deepEqual(asksOf(s, s.nodes[0]).map((x) => x.text), ["an ask"]);
});
