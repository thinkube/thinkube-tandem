/**
 * A repository that is several parts, each with a proved single-test
 * command, can run one check and read its verdict — no repository-wide
 * command is needed for that. And a check that falls outside every part,
 * with no wide command, is never run as nothing and called green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canJudgeOne } from "./whatWeKnow";
import { runAcVerifications } from "../engine/core/closingGate";

test("the parts' own proved commands are a way to judge one check", () => {
  assert.equal(canJudgeOne({ parts: { backend: { runOne: "pytest <file>" }, frontend: {} } }, undefined), true);
  assert.equal(canJudgeOne({ parts: { backend: {}, frontend: {} } }, undefined), false);
  assert.equal(canJudgeOne({}, { runOne: "npm test -- <file>" }), true);
});

test("an empty command runs nothing and judges nothing", async () => {
  let ran = 0;
  const [r] = await runAcVerifications([{ ac: 1, run: "", env: "local" }], "/nowhere", async () => {
    ran++;
    return { code: 0, output: "" };
  });
  assert.equal(ran, 0, "nothing was executed");
  assert.equal(r.pass, false);
  assert.equal(r.unrunnable, true);
  assert.match(r.evidence, /no command runs check #1/);
});
