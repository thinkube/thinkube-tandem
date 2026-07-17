/**
 * Webview UI integrity tests (2026-07-16 — field report: "most of the buttons
 * do nothing"). A single JS syntax error, or an onclick referencing an
 * undefined function, silently kills EVERY control in the webview — and no
 * prior probe class could see it. These tests render the real HTML and
 * mechanically verify the script and its wiring.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "./model";
import type { Action, WorkingModel } from "./model";
import { buildScratchpadHtml } from "./views/document";

function richModel(): WorkingModel {
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "a goal" }).model;
  m = reduce(m, { type: "addRoughRequest", text: "a rough ask" }).model;
  m = reduce(m, { type: "curateIntent", text: "curated" }).model;
  const elements = m.sections.find((s) => s.kind === "elements")!;
  const constraints = m.sections.find((s) => s.kind === "constraints")!;
  const p1: Action = {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: {
      text: "element one",
      modality: "mandatory",
      evals: { complexity: 2, risk: 3 },
      factors: { risk: "irreversible" },
      note: "Why: w. Impact: i. Modality: m.",
    },
  };
  m = reduce(m, p1).model;
  const elId = m.sections.find((s) => s.kind === "elements")!.items[0].id;
  const p2: Action = {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: constraints.id,
    item: {
      text: "constraint one",
      modality: "optional",
      evals: {},
      requires: [elId],
    },
  };
  m = reduce(m, p2).model;
  const conId = m.sections.find((s) => s.kind === "constraints")!.items[0].id;
  m = reduce(m, {
    type: "proposeEdit",
    actor: "integrator",
    itemId: conId,
    newText: "constraint one refined",
  }).model;
  m = reduce(m, { type: "checkItem", actor: "human", itemId: elId }).model;
  m = reduce(m, {
    type: "stampShipped",
    itemIds: [],
    flagIds: [conId],
    tepId: "TEP-7",
  }).model;
  return m;
}

/** Render with every optional surface active so all controls appear. */
function fullHtml(): string {
  const m = richModel();
  const elId = m.sections.find((s) => s.kind === "elements")!.items[0].id;
  const conId = m.sections.find((s) => s.kind === "constraints")!.items[0].id;
  return buildScratchpadHtml(
    m,
    undefined,
    undefined,
    "a command message",
    false,
    [conId], // staged selection → selection bar renders
    elId, // dependency focus → chips render
    [elId], // cut → cut bar renders
  );
}

function scriptOf(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "the webview must contain exactly one inline script");
  return match![1];
}

test("the webview script is syntactically valid JS — a syntax error kills every control", () => {
  const src = scriptOf(fullHtml());
  // new Function throws SyntaxError on invalid JS without executing it.
  assert.doesNotThrow(() => new Function(src));
});

test("every onclick handler in the HTML is defined in the script", () => {
  const html = fullHtml();
  const src = scriptOf(html);
  const names = new Set(
    [...html.matchAll(/onclick="([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]),
  );
  assert.ok(names.size >= 8, `expected many onclick handlers, got ${names.size}`);
  for (const name of names) {
    assert.ok(
      new RegExp(`function\\s+${name}\\s*\\(`).test(src),
      `onclick references '${name}' but the script defines no such function — that button does nothing`,
    );
  }
});

test("every delegated control class rendered is handled by the click listener", () => {
  const html = fullHtml();
  const src = scriptOf(html);
  // Controls wired via event delegation instead of onclick:
  const delegated = [
    "item-select",
    "item-explain",
    "item-research",
    "item-deps",
    "item-cut",
    "item-check",
    "eval-badge",
    "edit-accept",
    "edit-reject",
    "note-remove",
    "dep-chip",
    "evidence-chip",
    "item-resolve",
    "research-direction-go",
    "research-direction-cancel",
    "item-accept",
    "accept-reason-go",
    "accept-reason-cancel",
  ];
  for (const cls of delegated) {
    if (!html.includes(`class="${cls}`) && !html.includes(` ${cls}`)) continue;
    assert.ok(
      src.includes(`'${cls}'`) || src.includes(`"${cls}"`),
      `control class '${cls}' is rendered but never referenced by the script — those buttons do nothing`,
    );
  }
});

test("section display order: elements directly after goal, then constraints/gap/criteria/verification", () => {
  const html = fullHtml();
  const order = [...html.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [
    "goal",
    "elements",
    "constraints",
    "gap",
    "criteria",
    "verification",
  ]);
});

test("eval badges carry data-value so the cycle is deterministic (never parsed from label text)", () => {
  const html = fullHtml();
  assert.match(html, /class="eval-badge risk v3[^"]*" data-facet="risk" data-value="3"/);
  assert.match(html, /data-facet="complexity" data-value="2"/);
  // Unset badge: data-value="0" so the first click sets 1.
  assert.match(html, /data-value="0"/);
});
