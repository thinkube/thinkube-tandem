/**
 * A unit answers for what IT wrote, not for what it found in the tree.
 *
 * Every unit works in one shared worktree, and the guard read the whole
 * tree on every write: any file dirty and outside this unit's clearance was
 * its violation, restored, and on the second one the unit was killed.
 *
 * So one unit wrote a scratch file — `src/surfaces/__probe.ts` at 10:29:43,
 * removed at 10:29:54 — and inside that window a second unit saved
 * `implications.ts`, a file it was perfectly cleared for. The guard read the
 * tree, found the neighbour's scratch, warned the wrong unit; fourteen
 * seconds later the neighbour's second scratch file killed it. Its own
 * words at the time: "I only wrote implications.ts, which is in my
 * clearance list. It seems to reference a different file I never touched."
 * Its work was reverted and its promises came back unkept.
 *
 * A file tool names the path it wrote. Nothing has to be inferred from a
 * tree that four workers share.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathsNamedByTool } from "./worker";

const WT = "/wt/tandem__TEP-31";

test("a file tool answers for the path it named, given as the repository sees it", () => {
  assert.deepEqual(
    pathsNamedByTool({ tool_name: "Write", tool_input: { file_path: `${WT}/src/surfaces/implications.ts` } }, WT),
    ["src/surfaces/implications.ts"],
  );
  assert.deepEqual(
    pathsNamedByTool({ tool_name: "Edit", tool_input: { file_path: `${WT}/webview/map/src/Implications.tsx` } }, WT),
    ["webview/map/src/Implications.tsx"],
  );
  assert.deepEqual(
    pathsNamedByTool({ tool_name: "NotebookEdit", tool_input: { notebook_path: `${WT}/notes.ipynb` } }, WT),
    ["notes.ipynb"],
  );
});

/**
 * The whole point: what a neighbour left in the tree is not this call's.
 *
 * The guard narrows the tree to the paths the call named. SL-13 saved two
 * files it owned while SL-1's scratch sat beside them; narrowed, there is
 * nothing of SL-1's left to charge it with.
 */
test("a neighbour's stray file is not in what this call wrote", () => {
  const dirtyTree = [
    "src/surfaces/implications.ts", // SL-13 wrote this — its own
    "webview/map/src/Implications.tsx", // and this
    "src/surfaces/__probe.ts", // SL-1's scratch, six seconds old
    "src/surfaces/__probe2.ts", // SL-1's second, which killed SL-13
  ];
  const wrote = pathsNamedByTool(
    { tool_name: "Write", tool_input: { file_path: `${WT}/src/surfaces/implications.ts` } },
    WT,
  );
  const answerable = dirtyTree.filter((p) => wrote.includes(p));
  assert.deepEqual(answerable, ["src/surfaces/implications.ts"], "one file, the one it actually wrote");
  assert.equal(
    answerable.some((p) => p.includes("__probe")),
    false,
    "and nothing of the neighbour's, which is what failed the wrong unit",
  );
});

test("a shell command names no path, so the tree is still all there is to go on", () => {
  assert.deepEqual(
    pathsNamedByTool({ tool_name: "Bash", tool_input: { command: "cat > src/surfaces/__probe.ts <<'EOF'" } }, WT),
    [],
    "no narrowing: a shell can write anywhere, and the unit running it is the plausible author",
  );
  assert.deepEqual(pathsNamedByTool({ tool_name: "Write" }, WT), [], "a call with no input narrows nothing either");
});

test("a path already relative is left as it is", () => {
  assert.deepEqual(
    pathsNamedByTool({ tool_name: "Write", tool_input: { file_path: "src/surfaces/panel.ts" } }, WT),
    ["src/surfaces/panel.ts"],
  );
});
