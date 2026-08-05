/**
 * The expander (SP-11 ACs): one interaction reveals the complete text as
 * body content (never tooltip-only), and the id-keyed store keeps expansion
 * through an ELK re-layout (new geometry, same store, no re-invocation).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createExpansionStore,
  expandableLabel,
  renderNodeLabelMarkup,
} from "./expander";

const LONG = "a label far too long to fit inside one compact node frame";

test("expandableLabel: expanded body is the full text; no tooltip field; fitting text has no expander", () => {
  const collapsed = expandableLabel({ text: LONG, maxChars: 20, expanded: false });
  assert.ok(collapsed.truncated);
  assert.notEqual(collapsed.body, LONG);
  assert.deepEqual(collapsed.expander, { label: "more…", action: "toggle" });

  const expanded = expandableLabel({ text: LONG, maxChars: 20, expanded: true });
  assert.equal(expanded.body, expanded.full, "expanded body IS the complete text");
  assert.deepEqual(Object.keys(expanded).sort(), ["body", "expanded", "expander", "full", "truncated"], "no tooltip/title field exists on the model");

  assert.equal(expandableLabel({ text: "short", maxChars: 20, expanded: false }).expander, null);
});

test("AC1: one interaction against the expander yields markup with the complete text as body content", () => {
  const store = createExpansionStore();
  const layout = { x: 40, y: 60 };
  const collapsedMarkup = renderNodeLabelMarkup(
    { id: "n1", text: LONG, maxChars: 20, expanded: store.isExpanded("n1") },
    layout,
  );
  assert.ok(!collapsedMarkup.includes(LONG), "collapsed shows the truncated form");
  assert.match(collapsedMarkup, /data-expander="n1"/, "the affordance is a real element");

  store.toggle("n1"); // the single interaction the expander element dispatches
  const expandedMarkup = renderNodeLabelMarkup(
    { id: "n1", text: LONG, maxChars: 20, expanded: store.isExpanded("n1") },
    layout,
  );
  const bodyText = [...expandedMarkup.matchAll(/<text[^>]*data-label-line>([^<]*)<\/text>/g)]
    .map((m) => m[1])
    .join(" ");
  assert.equal(bodyText, LONG, "the complete label text is body content");
  assert.ok(!/<title>|title="/.test(expandedMarkup), "no tooltip/title carries the text");
});

test("AC2: after the reflow (new layout, same store) the expanded text persists without re-invoking the expander", () => {
  const store = createExpansionStore();
  store.toggle("n1");
  const before = renderNodeLabelMarkup(
    { id: "n1", text: LONG, maxChars: 20, expanded: store.isExpanded("n1") },
    { x: 40, y: 60 },
  );
  // The expansion changed the node's size; ELK re-lays-out → new geometry.
  const after = renderNodeLabelMarkup(
    { id: "n1", text: LONG, maxChars: 20, expanded: store.isExpanded("n1") },
    { x: 500, y: 220 },
  );
  for (const markup of [before, after]) {
    const body = [...markup.matchAll(/<text[^>]*data-label-line>([^<]*)<\/text>/g)]
      .map((m) => m[1])
      .join(" ");
    assert.equal(body, LONG);
  }
  assert.ok(after.includes('translate(500,220)'), "geometry moved with the reflow");
  assert.deepEqual(store.expandedIds(), ["n1"], "state read back by id, not layout identity");
});

test("store: toggle/set/subscribe round-trip", () => {
  const store = createExpansionStore(["a"]);
  let fired = 0;
  const off = store.subscribe(() => fired++);
  store.toggle("a");
  store.setExpanded("b", true);
  assert.equal(store.isExpanded("a"), false);
  assert.deepEqual(store.expandedIds(), ["b"]);
  assert.equal(fired, 2);
  off();
  store.toggle("b");
  assert.equal(fired, 2, "unsubscribed listener does not fire");
});
