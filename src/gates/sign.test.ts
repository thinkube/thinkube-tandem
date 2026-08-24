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
import { signedIds } from "../core/cutClosure";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { sweepSpaceResidue } from "../run/residue";

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
  const signed = signCut(
    base,
    { id: "cut-1", changeIds: ["n1"], docsNotNeeded: "greet() is self-explanatory" },
    "2026-08-22T00:00:00Z",
    "t",
  );
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
  const signed = signCut(
    at("src/greet.ts", "aaa"),
    { id: "cut-1", changeIds: ["n1"], docsNotNeeded: "greet() is self-explanatory" },
    "2026-08-22T00:00:00Z",
    "t",
  );
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

test("a promise whose every criterion is an observation signs — it has nothing to prove", () => {
  // The rule that moves observations out of the checks left one promise
  // with none, and the sign gate refused it for having no check — a gate
  // demanding a check for what the design says must never be one.
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "say plainly what the machine cannot see about the tabs",
        serves: [],
        needs: [],
        acceptance: [],
        unverified: [{ text: "the tab strip shows two tabs", why: "only the running product can show it" }],
        grounding: { touchpoints: [{ path: "src/x.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const r = signCut(
    space,
    { id: "cut-1", changeIds: ["n1"], docsNotNeeded: "the tab strip has no page of its own to update" },
    "2026-08-23T00:00:00Z",
    "t",
  );
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  assert.doesNotMatch(renderCutScreen(space, { id: "cut-1", changeIds: ["n1"] }), /Nothing proves these yet/);
  assert.match(renderCutScreen(space, { id: "cut-1", changeIds: ["n1"] }), /cannot prove these/);
});

test("a promise with neither a check nor an observation is still refused", () => {
  const space = {
    ...emptySpace(),
    nodes: [{ id: "n1", sentence: "a thing", serves: [], needs: [], acceptance: [], grounding: { touchpoints: [{ path: "src/x.ts" }], stamp: [] } }],
  };
  const r = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-23T00:00:00Z", "t");
  assert.equal(r.ok, false);
});

test("a withdrawn cut freezes nothing and is not the signed work waiting to run", () => {
  // Signed work that delivered nothing was a dead end: runnable, never
  // re-thinkable. Withdrawing it releases its promises to be derived anew.
  const cuts = [
    { id: "cut-1", changeIds: ["n1", "n2"], signature: { at: "", renderHash: "", groundingHash: "" } },
    { id: "cut-2", changeIds: ["n3"], signature: { at: "", renderHash: "", groundingHash: "" }, withdrawnAt: "2026-08-23T17:00:00Z" },
  ];
  assert.deepEqual([...signedIds(cuts)].sort(), ["n1", "n2"], "a withdrawn cut's promises are free");
});

test("withdrawing a cut clears the run it leaves behind", async () => {
  // Think again withdrew a cut and left its branch, its worktree and two
  // runner trees on the machine. The next cut mints its own number and
  // never resumes that branch, so what is left is a tree nobody reopens.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sweep-"));
  const repo = path.join(base, "repo");
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" });
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q", repo]);
  g(repo, "config", "user.email", "t@t");
  g(repo, "config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  g(repo, "add", "a.txt");
  g(repo, "commit", "-qm", "seed");

  const wtRoot = path.join(base, "repo-worktrees");
  const wt = path.join(wtRoot, "space__TEP-9");
  g(repo, "worktree", "add", "-q", "-b", "tandem/space/TEP-9", wt);
  fs.mkdirSync(path.join(wtRoot, "oracle-runners", "space__TEP-9-SL-1"), { recursive: true });
  fs.mkdirSync(path.join(wtRoot, "locks"), { recursive: true });
  fs.writeFileSync(path.join(wtRoot, "locks", "space__TEP-9.json"), "{}");

  const swept = await sweepSpaceResidue({ repoRoot: repo, teps: ["TEP-9"], branches: ["tandem/space/TEP-9"] });

  assert.ok(!fs.existsSync(wt), "the run's tree is gone");
  assert.ok(!fs.existsSync(path.join(wtRoot, "oracle-runners", "space__TEP-9-SL-1")), "and its runner trees");
  assert.ok(!fs.existsSync(path.join(wtRoot, "locks", "space__TEP-9.json")), "and the lock that would refuse the next run");
  assert.ok(!g(repo, "branch", "--list").includes("TEP-9"), "and the branch");
  assert.ok(swept.removed.length >= 3, JSON.stringify(swept));
});

test("the promises of a withdrawn cut can be signed again as new work", () => {
  // Withdrawing released them to be thought through again; a gate that
  // still counts them as frozen refuses every signature that follows, and
  // the person is left with a button that does nothing.
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a thing",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "it works" }],
        grounding: { touchpoints: [{ path: "docs/x.md", planned: true }], stamp: [] },
      },
    ],
    cuts: [
      {
        id: "cut-1",
        changeIds: ["n1"],
        signature: { at: "", renderHash: "", groundingHash: "" },
        withdrawnAt: "2026-08-23T18:00:00Z",
      },
    ],
  };
  const r = signCut(space, { id: "cut-2", changeIds: ["n1"] }, "2026-08-23T18:01:00Z", "t");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});

test("a redrawn page is not the promises changing", async () => {
  // The signature covers two halves. The grounded half is the substance —
  // every sentence, where it lands, every check's own words, what each
  // needs. The other is the PAGE those facts are drawn on, and it moves
  // whenever the drawing code moves: nobody signs a wording, and nobody
  // changed one on purpose. Refusing on it stopped a re-run of a cut whose
  // work was already built and proved, saying "the promises changed after
  // they were signed" about promises that had not.
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a space opens in its own tab",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "opening twice reveals one tab" }],
        grounding: { touchpoints: [{ path: "src/a.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const signed = signCut(space as never, { id: "cut-1", changeIds: ["n1"] }, "2026-01-01T00:00:00Z", "t", 1);
  assert.ok(signed.ok);
  const cut = signed.cut;

  // The page is redrawn: same facts, a hash that no longer matches.
  const redrawn = { ...cut, signature: { ...cut.signature!, renderHash: "0000000000000000" } };
  const v = verifyCutSignature({ ...space, cuts: [redrawn] } as never, redrawn);
  assert.equal(v.ok, true, "a redrawn page refused a cut whose promises are unchanged");
  assert.match((v as { unchecked?: string }).unchecked ?? "", /the page was redrawn, not the work/);

  // The substance moving is still refused, and says which half.
  const moved = { ...space, nodes: [{ ...space.nodes[0], sentence: "something else entirely" }] };
  const g = verifyCutSignature({ ...moved, cuts: [cut] } as never, cut);
  assert.equal(g.ok, false);
  assert.equal((g as { drift?: string }).drift, "grounding");
});
