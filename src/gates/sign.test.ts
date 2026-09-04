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
import { renderCutScreen, renderDeliveryPage } from "./render";
import { emptySpace, type Space } from "../core/schema";
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

/**
 * What a signature is over.
 *
 * The promises. Not where the repository sits, not where a proof was
 * recorded, not how the page was rendered this time. Each of those moved
 * once without anybody touching the work, and every signed cut read as
 * drifted — a person asked to re-sign for a change they did not make.
 */
test("a signature covers the promises, not the page or the place they live in", async () => {
  {
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
    { id: "cut-1", changeIds: ["n1"], docsExemption: { reason: "no docs promised in this cut", at: "2026-08-22T00:00:00Z" } },
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
  }
  {
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
    { id: "cut-1", changeIds: ["n1"], docsExemption: { reason: "no docs promised in this cut", at: "2026-08-22T00:00:00Z" } },
    "2026-08-22T00:00:00Z",
    "t",
  );
  assert.ok(signed.ok, signed.ok ? "" : signed.reason);

  // The repository moved: a new head, a re-read evidence line. Same promise.
  assert.deepEqual(verifyCutSignature(at("src/greet.ts", "bbb"), signed.cut), { ok: true });

  // The promise now lands somewhere else. That is drift.
  assert.equal(verifyCutSignature(at("src/other.ts", "aaa"), signed.cut).ok, false);
  }
  {
  // The signature covers two halves. The grounded half is the substance —
  // every sentence, where it lands, every check's own words. The other is
  // the PAGE those facts are drawn on, and it moves
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
  const signed = signCut(
    space as never,
    { id: "cut-1", changeIds: ["n1"], docsExemption: { reason: "no docs promised in this cut", at: "2026-01-01T00:00:00Z" } },
    "2026-01-01T00:00:00Z",
    "t",
    1,
  );
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
  }
});


/**
 * What the person is shown before they sign or accept.
 *
 * Where each promise lands and what cannot be proven at all. A claim
 * settled by review reads as proved, not as pending. And a finding is
 * theirs to weigh — only a red check refuses the accept, because a machine
 * opinion is not a veto over a person's judgement.
 */
test("the person reads where each promise lands, what was proved, and what is only a finding", async () => {
  {
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
  }
  {
  // A runnable check's proof is labelled with the criterion's own text, so
  // matching a claim to its proof BY TEXT worked for those. A review's
  // proof is labelled "review-3: " plus the first sixty characters — it can
  // never equal the criterion. So every claim proved only by review read
  // "NOT true yet; nothing proved it" while the same page listed its green
  // review directly underneath, and a person was told four asks were
  // unproved over a page of evidence that they were kept.
  const space = {
    ...emptySpace(),
    subjects: [{ id: "s1", name: "Documentation", from: [] }],
    claims: [{ id: "cl1", subjectId: "s1", text: "is required by default for every cut", fromAsk: "ask-1" }],
    nodes: [
      {
        id: "n1",
        sentence: "a cut with no documentation cannot sign",
        serves: ["ask-1"],
        servesClaim: "cl1",
        needs: [],
        acceptance: [
          { id: "c1", text: "the gates page states the rule, and sign.ts enforces it", kind: "assessment" },
        ],
      },
    ],
  };
  const delivery = {
    id: "d1",
    cutId: "cut-1",
    branch: "b",
    proofs: [
      {
        kind: "assessment" as const,
        criterionId: "c1",
        // The label a reviewer's proof really carries: never the criterion.
        label: "review-1: the gates page states the rule, and sign.ts enfo",
        verdict: "green" as const,
      },
    ],
  };
  const page = renderDeliveryPage({ ...space, cuts: [{ id: "cut-1", changeIds: ["n1"] }] } as never, delivery as never);
  assert.match(page, /Documentation — 1 of 1 now true/);
  assert.match(page, /✓ is required by default for every cut/);
  assert.doesNotMatch(page, /nothing proved it/);
  }
  {
  // Every rule that fired at the gate held veto power, so a suite opinion
  // — a size rule, a reachability view — could hold four kept promises
  // hostage with every actor spent. The person at Accept is the only
  // actor left for such findings, and this press is the act.
  const base = {
    id: "d1", cutId: "c1", branch: "b",
    findings: ["module size: plan.ts is 616 lines"],
    proofs: [
      { kind: "probe" as const, label: "the tab shows the name", verdict: "green" as const },
      { kind: "assessment" as const, label: "review-14: one sentence each", verdict: "red" as const },
      { kind: "suite" as const, label: "repo suite", verdict: "red" as const },
    ],
  };
  assert.equal(acceptDelivery(base as never, "now").ok, true, "a finding became a veto through the back door");
  const redCheck = {
    ...base,
    proofs: [...base.proofs, { kind: "probe" as const, label: "opening twice reveals one tab", verdict: "red" as const }],
  };
  const r = acceptDelivery(redCheck as never, "now");
  assert.equal(r.ok, false, "an unkept promise must still refuse");
  assert.match((r as { reason: string }).reason, /opening twice reveals one tab/);
  }
});

/**
 * A cut that lands in more than one repository.
 *
 * It is one piece of work, so it is accepted once ALL of its repositories
 * are — and a sibling that was withheld is named as withheld, not left to
 * look like one that simply has not arrived.
 */
test("a cut spanning repositories is accepted only when every one of them is", () => {
  {
  const web = green("d-web", "cut-1", "tandem/web/TEP-1");
  const api = green("d-api", "cut-1", "tandem/api/TEP-1");
  const r = acceptDelivery(web, "2026-08-22T00:00:00Z", "advisory", [web, api]);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /also lands in 1 other repository/);
  assert.match(r.ok ? "" : r.reason, /tandem\/api\/TEP-1/);
  }
  {
  const web = green("d-web", "cut-1", "tandem/web/TEP-1");
  const api = { ...green("d-api", "cut-1", "tandem/api/TEP-1"), acceptedAt: "2026-08-22T00:00:00Z" };
  const r = acceptDelivery(web, "2026-08-22T00:01:00Z", "advisory", [web, api]);
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  }
  {
  const web = green("d-web", "cut-1", "tandem/web/TEP-1");
  const api = { ...green("d-api", "cut-1", "tandem/api/TEP-1"), withheld: "two promises are not kept" };
  const r = acceptDelivery(web, "2026-08-22T00:00:00Z", "advisory", [web, api]);
  assert.match(r.ok ? "" : r.reason, /withheld/);
  }
});



/**
 * What a promise must carry to be signable.
 *
 * Some promises can only be observed by a person — a colour, a feel. Those
 * sign with observations alone. A promise carrying neither a check nor an
 * observation carries no way to know it was kept, and is refused.
 */
test("a promise signs with observations alone, but never with nothing", () => {
  {
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
    { id: "cut-1", changeIds: ["n1"], docsExemption: { reason: "no docs promised in this cut", at: "2026-08-23T00:00:00Z" } },
    "2026-08-23T00:00:00Z",
    "t",
  );
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  assert.doesNotMatch(renderCutScreen(space, { id: "cut-1", changeIds: ["n1"] }), /Nothing proves these yet/);
  assert.match(renderCutScreen(space, { id: "cut-1", changeIds: ["n1"] }), /cannot prove these/);
  }
  {
  const space = {
    ...emptySpace(),
    nodes: [{ id: "n1", sentence: "a thing", serves: [], needs: [], acceptance: [], grounding: { touchpoints: [{ path: "src/x.ts" }], stamp: [] } }],
  };
  const r = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-23T00:00:00Z", "t");
  assert.equal(r.ok, false);
  }
});


/**
 * Withdrawing a cut.
 *
 * It stops being the signed work waiting to run, its promises are free to
 * be signed again as new work, and the run it left behind is cleared —
 * otherwise a space holds a run nobody can start and promises nobody can
 * re-sign.
 */
test("a withdrawn cut releases its promises, its run and its hold on the space", async () => {
  {
  // Signed work that delivered nothing was a dead end: runnable, never
  // re-thinkable. Withdrawing it releases its promises to be derived anew.
  const cuts = [
    { id: "cut-1", changeIds: ["n1", "n2"], signature: { at: "", renderHash: "", groundingHash: "" } },
    { id: "cut-2", changeIds: ["n3"], signature: { at: "", renderHash: "", groundingHash: "" }, withdrawnAt: "2026-08-23T17:00:00Z" },
  ];
  assert.deepEqual([...signedIds(cuts)].sort(), ["n1", "n2"], "a withdrawn cut's promises are free");
  }
  {
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
  }
  {
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
  }
});






test("the machine's own plan edges are not signed: the door prunes them before it plans", async () => {
  // An edge two promises share only through a test file belongs to the
  // maintain slice, and the door drops it on its way to the work. Hashed,
  // that made the run refuse the signature it had made four seconds
  // earlier: "where the promises land changed after they were signed".
  const node = (id: string, needs: string[]) => ({
    id,
    sentence: `promise ${id}`,
    serves: [],
    needs,
    acceptance: [{ id: `${id}-c1`, text: "it holds" }],
    grounding: { touchpoints: [{ path: `src/${id}.ts`, planned: false }], stamp: [] },
  });
  const space: Space = { ...emptySpace(), nodes: [node("n1", []), node("n2", ["n1"])] as never };
  const signed = signCut(
    space,
    { id: "cut-1", changeIds: ["n1", "n2"], askIds: [], docsExemption: { reason: "an example, not a delivery", at: "2026-01-01T00:00:00Z" } } as never,
    "2026-01-01T00:00:00Z",
    "me",
  );
  assert.ok("cut" in signed, JSON.stringify(signed));
  assert.equal(verifyCutSignature(space, signed.cut).ok, true);

  // The door prunes the edge; nothing a person read has changed.
  const pruned: Space = { ...space, nodes: space.nodes.map((n) => ({ ...n, needs: [] })) };
  assert.equal(verifyCutSignature(pruned, signed.cut).ok, true, "the run may plan without unsigning its own work");

  // What a person did read still holds the signature to account.
  const moved: Space = {
    ...space,
    nodes: space.nodes.map((n) => (n.id === "n2" ? { ...n, sentence: "something else entirely" } : n)),
  };
  assert.equal(verifyCutSignature(moved, signed.cut).ok, false, "a sentence that moved is drift");
});
