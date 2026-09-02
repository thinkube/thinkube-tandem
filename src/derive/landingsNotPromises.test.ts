/**
 * The completeness pass adds landings to the promises the sentences made;
 * it never adds a promise. On a fresh reading of the todo template it
 * turned five promises into seventeen, eleven of them remarks on code the
 * work did not change — each a worker at build time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { completeCut } from "./complete";
import type { Change } from "../core/schema";

const change = (id: string, sentence: string, paths: string[]): Change =>
  ({
    id,
    sentence,
    serves: ["subject-1"],
    servesClaim: "claim-1",
    grounding: { touchpoints: paths.map((p) => ({ path: p })), stamp: [] },
    acceptance: [{ id: `${id}-check-1`, text: "it holds" }],
    needs: [],
  }) as unknown as Change;

test("what must move lands on the promise it serves; nothing new is minted", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-complete-"));
  fs.mkdirSync(path.join(root, "backend/app/api"), { recursive: true });
  fs.writeFileSync(path.join(root, "backend/app/api/tasks.py"), "def list_tasks(): pass\n");
  const changes = [
    change("node-1", "The list comes back sorted.", ["backend/app/api/tasks.py"]),
    change("node-2", "Each card shows its priority.", ["frontend/src/views/Home.vue"]),
  ];
  const round = async (): Promise<string> =>
    JSON.stringify({
      landings: [
        { change: 0, path: "backend/app/models/task.py", symbol: "TaskPriority", why: "the rank must be defined once" },
        { change: 0, path: "backend/app/api/tasks.py", why: "already a landing" },
        { change: 1, path: "frontend/src/views/__tests__/Home.test.js", why: "pins the raw enum text this change replaces" },
        { change: 7, path: "frontend/src/i18n/index.js", why: "serves no derived change" },
        { change: 1, path: "", why: "no path" },
      ],
    });
  const grown = await completeCut(
    { model: "m", repoRoot: root },
    { claims: [{ id: "claim-1", subjectId: "subject-1", text: "the list is sorted" }], subjects: [{ id: "subject-1", name: "my tasks" }], changes },
    round,
  );
  assert.deepEqual(grown.map((g) => g.id).sort(), ["node-1", "node-2"], "only the promises that existed come back");
  const first = grown.find((g) => g.id === "node-1")!;
  assert.deepEqual(
    first.grounding!.touchpoints.map((t) => [t.path, t.symbol, t.evidence, t.planned ?? false]),
    [
      ["backend/app/api/tasks.py", undefined, undefined, false],
      ["backend/app/models/task.py", "TaskPriority", "the rank must be defined once", true],
    ],
    "the new landing is added once, with what the round saw there",
  );
  const second = grown.find((g) => g.id === "node-2")!;
  assert.equal(second.grounding!.touchpoints.length, 2);
  assert.equal(first.acceptance.length, 1, "no criterion is added: the contract is the sentence's");
});

test("a round that says nothing else must move changes nothing", async () => {
  const grown = await completeCut(
    { model: "m", repoRoot: os.tmpdir() },
    { claims: [{ id: "c", subjectId: "s", text: "x" }], subjects: [{ id: "s", name: "s" }], changes: [change("node-1", "x", ["a.py"])] },
    async () => '{"landings":[]}',
  );
  assert.deepEqual(grown, []);
});
