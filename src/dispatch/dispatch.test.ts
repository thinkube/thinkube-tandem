/**
 * Dispatch: anchors resolve to fresh lines against the actual worktree,
 * unresolvable anchors refuse the order (never the worker guessing),
 * orders partition the cut by unit with disjoint footprints, and the brief
 * tells the worker to open — not search.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveAnchor } from "./resolve";
import { assembleSliceBriefs, renderSliceBrief } from "./briefs";
import { detectForge, forgeFor, githubForge } from "./forge";
import { emptySpace, Space } from "../core/schema";
import { addAsk, addNode } from "../core/intent";

const FILES: Record<string, string> = {
  "/wt/src/panel/log.ts": [
    "import x from 'y';",
    "export function LogPanel() {",
    "  return 1;",
    "}",
  ].join("\n"),
};
const readFile = (abs: string) => FILES[abs];

test("anchors resolve to fresh lines; moved symbols and missing files refuse; planned files pass", () => {
  const hit = resolveAnchor("/wt", { path: "src/panel/log.ts", symbol: "LogPanel" }, readFile);
  assert.ok(hit.ok && hit.line === 2, "line rendered from this worktree");

  const gone = resolveAnchor("/wt", { path: "src/panel/log.ts", symbol: "OldName" }, readFile);
  assert.ok(!gone.ok && gone.reason.includes("no longer exists"));

  const missing = resolveAnchor("/wt", { path: "src/panel/nope.ts" }, readFile);
  assert.ok(!missing.ok && missing.reason.includes("does not exist"));

  const planned = resolveAnchor("/wt", { path: "src/panel/new.ts", planned: true }, readFile);
  assert.ok(planned.ok && planned.planned, "a file the change creates is not a refusal");
});

function makeSpace(): Space {
  let s = emptySpace();
  const a = addAsk(s, "follow the running step", "t");
  assert.ok(a.ok);
  s = a.space;
  const n1 = addNode(s, {
    sentence: "the log panel scrolls with the active step",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "scrolls", probePath: "probes/follow.test.ts" }],
    grounding: { touchpoints: [{ path: "src/panel/log.ts", symbol: "LogPanel" }], stamp: [] },
  });
  assert.ok(n1.ok);
  s = n1.space;
  const n2 = addNode(s, {
    sentence: "a capture box in the toolbar",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c2", text: "visible" }],
    grounding: { touchpoints: [{ path: "src/toolbar/capture.ts", planned: true }], stamp: [] },
  });
  assert.ok(n2.ok);
  return n2.space;
}

test("orders partition by unit with disjoint footprints; briefs carry coordinates and the honesty protocol", () => {
  const space = makeSpace();
  const cut = { id: "cut-1", changeIds: space.nodes.map((n) => n.id) };
  const orders = assembleSliceBriefs(space, cut, "/wt", [], readFile);
  assert.equal(orders.length, 2, "two units, two orders");
  assert.ok(orders.every((o) => o.ok));
  const footprints = orders.flatMap((o) => (o.ok ? o.order.footprint : []));
  assert.equal(new Set(footprints).size, footprints.length, "footprints disjoint");

  const first = orders.find((o) => o.ok && o.order.footprint.includes("src/panel/log.ts"))!;
  assert.ok(first.ok);
  const brief = renderSliceBrief(space, first.order, first.resolved);
  assert.ok(brief.includes("src/panel/log.ts:2 (LogPanel)"), "line rendered at dispatch");
  assert.ok(brief.includes("do NOT search"));
  assert.ok(brief.includes("done when: scrolls"));
  assert.ok(brief.includes("UNDELIVERED"));
  assert.ok(brief.includes("you may touch ONLY: src/panel/log.ts"));
});

test("an anchor that no longer resolves refuses the order and names the broken premise", () => {
  const space = makeSpace();
  const cut = { id: "cut-1", changeIds: [space.nodes[0].id] };
  const orders = assembleSliceBriefs(space, cut, "/other-worktree", [], () => undefined);
  assert.equal(orders.length, 1);
  assert.ok(!orders[0].ok);
  assert.ok(!orders[0].ok && orders[0].refusals[0].includes("does not exist"));
});

test("forge detection: github.com is GitHub, every other host is the platform's Gitea", () => {
  assert.equal(detectForge("git@github.com:thinkube/thinkube-tandem.git")?.kind, "github");
  const gitea = detectForge("https://git.thinkube.example/kubexlat/kubexlat.git");
  assert.equal(gitea?.kind, "gitea");
  assert.equal(gitea?.owner, "kubexlat");
  assert.throws(() => forgeFor("https://git.thinkube.example/o/r.git", {}), /no token/);
});

test("the GitHub adapter builds the exact commands; merge is the acceptance act", async () => {
  const calls: string[][] = [];
  const forge = githubForge(
    { kind: "github", host: "github.com", owner: "o", repo: "r" },
    async (cmd, args) => {
      calls.push([cmd, ...args]);
      return "https://github.com/o/r/pull/1";
    },
  );
  const url = await forge.openDelivery({ branch: "tandem/cut-1", title: "t", body: "b" });
  await forge.merge("1");
  assert.equal(url, "https://github.com/o/r/pull/1");
  assert.deepEqual(calls[0].slice(0, 4), ["gh", "pr", "create", "--repo"]);
  assert.deepEqual(calls[1].slice(0, 3), ["gh", "pr", "merge"]);
});

test("Gitea merge uses the PR INDEX extracted from the stored URL (A4)", async () => {
  const calls: string[] = [];
  const { forgeFor } = await import("./forge");
  const forge = forgeFor("https://git.thinkube.com/thinkube-deployments/todo.git", {
    giteaToken: "t",
    http: async (_m, url) => {
      calls.push(url);
      return {};
    },
  });
  await forge.merge("https://git.thinkube.com/thinkube-deployments/todo/pulls/5");
  assert.ok(calls[0].endsWith("/pulls/5/merge"), `hit ${calls[0]}`);
  await assert.rejects(() => forge.merge("https://git.thinkube.com/no/number/here"), /no pull-request number/);
});
