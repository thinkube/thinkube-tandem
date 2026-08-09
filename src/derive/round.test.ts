import { test } from "node:test";
import assert from "node:assert/strict";
import { collectText, volumeDeps } from "./round";

test("a round that fails after writing its answer keeps the answer", async () => {
  const said: string[] = [];
  const text = await collectText(async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text: '{"subjects":[]}' }] } };
    throw new Error("Reached maximum number of turns (1)");
  }, (l) => said.push(l));
  assert.equal(text, '{"subjects":[]}', "the reply arrived — a late failure must not discard it");
  assert.ok(said.some((l) => /ended early/.test(l) && /maximum number of turns/.test(l)));
});

test("a round that fails with nothing written returns nothing, and says why", async () => {
  const said: string[] = [];
  const text = await collectText(async function* () {
    throw new Error("network down");
    // eslint-disable-next-line no-unreachable
    yield {};
  }, (l) => said.push(l));
  assert.equal(text, null);
  assert.ok(said.some((l) => /round errored: network down/.test(l)));
});

test("a tool-less round is allowed to think before it answers", () => {
  const deps = volumeDeps({ model: "opus", volumeModel: "sonnet", repoRoot: "/repo" });
  assert.equal(deps.tools, "none");
  assert.equal(
    deps.maxTurns,
    undefined,
    "it carries no cap of its own — one turn killed readings that had already been written",
  );
});
