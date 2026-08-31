/**
 * The subjects are grouped into things worth delivering on their own.
 *
 * Nineteen asks about one surface became one cut and one delivery: sixty-two
 * promises, forty-one slices, three days, and a window in which every page
 * rendered at zero height. Five of those asks were about layout. Shipped
 * alone, that set would have shown the fault on the first afternoon.
 *
 * The grouping cannot come from files — clustering the failed run's slices by
 * shared files gives one blob of seventeen out of twenty-three, because that
 * is what a surface is. It cannot come from subjects alone either: seventeen
 * subjects over nineteen asks gave seventeen groups. It is a judgement about
 * meaning, so it is proposed and then corrected, and every rule below exists
 * so that a bad proposal cannot cost anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promisesOfSpec, proposeSpecs, specsFrom, specsPrompt } from "./specs";

const SUBJECTS = [
  { id: "s1", name: "the tab row", from: ["a1"] },
  { id: "s2", name: "the tab", from: ["a2"] },
  { id: "s3", name: "my asks", from: ["a3"] },
  { id: "s4", name: "every card in a run", from: ["a4"] },
  { id: "s5", name: "the audit card", from: ["a5"] },
];
const CLAIMS = [
  { id: "c1", subjectId: "s1", text: "stays in one place", fromAsk: "a1" },
  { id: "c4", subjectId: "s4", text: "labelled with the promise it keeps", fromAsk: "a4" },
];
const SPACE = { subjects: SUBJECTS, claims: CLAIMS } as never;
const answering = (json: string) => async () => json;
const mint = (n: number): string => `spec-${n}`;

test("it groups the subjects and keeps the person's own nouns in front of it", async () => {
  let asked = "";
  const got = await proposeSpecs({ repoRoot: "/x", model: "sonnet" } as never, SPACE, (async (_d: unknown, p: string) => {
    asked = p;
    return '{"specs":[{"name":"the layout is stable","subjects":[1,2,3]},{"name":"I can read the run graph","subjects":[4,5]}]}';
  }) as never);

  assert.match(asked, /the tab row/, "the person's noun, not an identifier");
  assert.match(asked, /stays in one place/, "and what they want to become true of it");
  assert.deepEqual(got?.specs, [
    { name: "the layout is stable", subjectIds: ["s1", "s2", "s3"] },
    { name: "I can read the run graph", subjectIds: ["s4", "s5"] },
  ]);
  assert.deepEqual(got?.loose, []);
});

test("a subject named twice lands in one set, never two", async () => {
  // In two sets it is built twice, and the second delivery rebuilds what the
  // first delivered — which is the cost this whole layer exists to avoid.
  const got = await proposeSpecs(
    { repoRoot: "/x", model: "sonnet" } as never,
    SPACE,
    answering('{"specs":[{"name":"one","subjects":[1,2]},{"name":"two","subjects":[2,4]}]}') as never,
  );
  assert.deepEqual(got?.specs, [
    { name: "one", subjectIds: ["s1", "s2"] },
    { name: "two", subjectIds: ["s4"] },
  ]);
});

test("a subject the round forgot is not dropped", async () => {
  const got = await proposeSpecs(
    { repoRoot: "/x", model: "sonnet" } as never,
    SPACE,
    answering('{"specs":[{"name":"the layout is stable","subjects":[1,2]}]}') as never,
  );
  assert.deepEqual(got?.loose, ["s3", "s4", "s5"], "what it left out is carried, not lost");

  const specs = specsFrom(got!, mint);
  assert.equal(specs.length, 2);
  assert.deepEqual(specs[1], {
    id: "spec-2",
    name: "everything else you asked for",
    subjectIds: ["s3", "s4", "s5"],
  });
});

test("an invented subject is ignored rather than trusted", async () => {
  const got = await proposeSpecs(
    { repoRoot: "/x", model: "sonnet" } as never,
    SPACE,
    answering('{"specs":[{"name":"a set","subjects":[1,99]}]}') as never,
  );
  assert.deepEqual(got?.specs[0].subjectIds, ["s1"]);
});

test("a round that answers nothing leaves the space as it was", async () => {
  for (const reply of ["", "I could not group these.", '{"specs":[]}', "{ broken"])
    assert.equal(
      await proposeSpecs({ repoRoot: "/x", model: "sonnet" } as never, SPACE, answering(reply) as never),
      undefined,
      `a bad grouping is worse than none — the person can always make it themselves (${reply.slice(0, 12)})`,
    );
});

test("one subject is not a grouping problem", async () => {
  let asked = false;
  const got = await proposeSpecs(
    { repoRoot: "/x", model: "sonnet" } as never,
    { subjects: [SUBJECTS[0]], claims: [] } as never,
    (async () => ((asked = true), "{}")) as never,
  );
  assert.equal(got, undefined);
  assert.equal(asked, false, "and nothing is spent asking");
});

test("the round is told what a set is for, and how to name it", () => {
  const p = specsPrompt(SUBJECTS, CLAIMS);
  assert.match(p, /BUILD AND\nSHOW SEPARATELY/, "the point of the grouping is delivery, not tidiness");
  assert.match(p, /look at on its own and say whether it is better/);
  assert.match(p, /Never a\ncategory, never a component name/, "a set is named by what becomes true");
  assert.match(p, /exactly one set/);
});

/**
 * A spec reaches its promises through the space's own edges.
 *
 * The grouping is made of subjects, which exist on the first screen in the
 * person's nouns. Promises come later. The path between them is already in
 * the space — a subject names the asks it came from, a promise says which
 * asks it serves — so nothing new has to be recorded to know what a set
 * covers.
 */
test("a spec covers the promises serving its subjects' asks", () => {
  const space = {
    subjects: SUBJECTS,
    nodes: [
      { id: "n1", serves: ["a1"], sentence: "the row holds still" },
      { id: "n2", serves: ["a4"], sentence: "cards say what they keep" },
      { id: "n3", serves: ["a9"], sentence: "something else entirely" },
    ],
  } as never;
  const spec = { id: "spec-1", name: "the layout is stable", subjectIds: ["s1", "s2"] };
  assert.deepEqual(promisesOfSpec(space, spec), ["n1"]);
});

test("a promise serving two sets belongs to both, and is not lost by either", () => {
  // The sets group what the person ASKED for, not the code. Whichever set is
  // built first carries the promise; the second finds it already kept.
  const space = {
    subjects: SUBJECTS,
    nodes: [{ id: "n1", serves: ["a1", "a4"], sentence: "one promise, two asks" }],
  } as never;
  assert.deepEqual(promisesOfSpec(space, { id: "x", name: "layout", subjectIds: ["s1"] }), ["n1"]);
  assert.deepEqual(promisesOfSpec(space, { id: "y", name: "cards", subjectIds: ["s4"] }), ["n1"]);
});

test("a set nothing is derived from yet covers nothing, rather than everything", () => {
  const space = { subjects: SUBJECTS, nodes: [] } as never;
  assert.deepEqual(promisesOfSpec(space, { id: "x", name: "layout", subjectIds: ["s1"] }), []);
});
