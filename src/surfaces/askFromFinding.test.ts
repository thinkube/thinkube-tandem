/**
 * A finding enters the box as a want, in the person's own voice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { wantsFrom } from "./askFromFinding";

const deps = { model: "m", repoRoot: "/nowhere" };

test("each observation becomes one sentence asking for the behaviour instead", async () => {
  const round = async (_d: unknown, prompt: string) => {
    assert.match(prompt, /Reaching the Create Task button/);
    return JSON.stringify([
      "The Create Task button is reachable in a few Tab presses from the top of the page.",
      "The date fields say what format they want.",
    ]);
  };
  assert.deepEqual(
    await wantsFrom(
      [
        "Reaching the Create Task button takes 11 Tab presses, because the whole sidebar and header come first.",
        "None of the date fields say what format they want.",
      ],
      deps,
      round as never,
    ),
    [
      "The Create Task button is reachable in a few Tab presses from the top of the page.",
      "The date fields say what format they want.",
    ],
  );
});

test("a conversion that fails hands the findings over unchanged", async () => {
  const observed = ["something seen, verbatim"];
  assert.deepEqual(await wantsFrom(observed, deps, (async () => null) as never), observed);
  assert.deepEqual(await wantsFrom(observed, deps, (async () => "not json at all") as never), observed);
  assert.deepEqual(
    await wantsFrom(observed, deps, (async () => JSON.stringify(["a", "b"])) as never),
    observed,
    "the wrong number of answers is nobody's rewrite",
  );
});
