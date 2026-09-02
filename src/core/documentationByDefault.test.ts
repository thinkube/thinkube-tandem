/**
 * Documentation is part of every delivery by default. A chosen thing whose
 * promises land no page gets the page promised by the machine, minted so
 * it informs and never withholds; a thing that already lands one gets
 * nothing added; and the promise can be taken out, which is the exemption.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { configureDocsRoots, docsDuty, documentationPromise } from "./docsDuty";
import { machineMinted } from "./schema";
import { emptySpace, Space } from "./schema";

function space(touches: string): Space {
  return {
    ...emptySpace(),
    asks: [{ id: "a1", text: "one", at: "" }] as Space["asks"],
    subjects: [{ id: "subject-1", name: "the list", from: ["a1"] }],
    claims: [{ id: "c1", subjectId: "subject-1", text: "sorted", fromAsk: "a1" }],
    nodes: [
      {
        id: "n1",
        sentence: "the list comes back sorted",
        serves: ["subject-1"],
        servesClaim: "c1",
        needs: [],
        acceptance: [],
        grounding: { touchpoints: [{ path: touches }], stamp: [] },
      },
    ] as unknown as Space["nodes"],
  };
}
const thing = { name: "See what to do next", subjectIds: ["subject-1"] };
const mint = (n: number) => `node-ana-gap-${n}`;

test("a thing that lands no page gets the page promised, under the documentation root", () => {
  const sp = space("backend/app/api/tasks.py");
  const docs = documentationPromise(sp, thing, mint);
  assert.ok(docs, "the promise is added");
  assert.match(docs!.grounding!.touchpoints[0].path, /^docs\/see-what-to-do-next\.md$/);
  assert.equal(docs!.servesClaim, "c1", "it sits under the thing's own claim, where the page shows it");
  assert.equal(machineMinted({ criterionId: docs!.acceptance[0].id }), true, "minted: it informs and never withholds");
  const withIt = { ...sp, nodes: [...sp.nodes, docs!] };
  assert.equal(docsDuty(withIt, { id: "cut", changeIds: ["n1", docs!.id] }).state, "landed");
});

test("a repository with an Antora site gets an .adoc page in its ROOT module, listed in the nav", () => {
  configureDocsRoots(["docs/modules"]);
  try {
    const docs = documentationPromise(space("backend/app/api/tasks.py"), thing, mint)!;
    assert.equal(docs.grounding!.touchpoints[0].path, "docs/modules/ROOT/pages/see-what-to-do-next.adoc");
    assert.equal(docs.grounding!.touchpoints[1].path, "docs/modules/ROOT/nav.adoc");
    assert.match(docs.acceptance[0].text, /nav\.adoc lists it/);
  } finally {
    configureDocsRoots(undefined);
  }
});

test("a thing that already lands a page gets nothing added", () => {
  assert.equal(documentationPromise(space("docs/tasks.md"), thing, mint), undefined);
});

test("it is added once", () => {
  const sp = space("backend/app/api/tasks.py");
  const docs = documentationPromise(sp, thing, mint)!;
  assert.equal(documentationPromise({ ...sp, nodes: [...sp.nodes, docs] }, thing, mint), undefined);
});
