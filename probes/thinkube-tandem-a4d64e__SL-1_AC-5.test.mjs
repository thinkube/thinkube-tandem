// TRANSITION — proves the run's docs gate (src/run/plan.ts docsObligations)
// stopped re-testing a docs/ prefix itself and now agrees, path for path,
// with isDocPath's classification of a slice's declared files. Once the gate
// is rewired onto the shared rule this test's job (catching a re-diverged
// private copy) still stands, but the change it proves — the rewire itself
// — is a one-time event.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isDocPath } from "../out-test/core/docs.js";
import { docsObligations } from "../out-test/run/plan.js";

function tmpWorktree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl1-ac5-"));
  return dir;
}

test("docsObligations agrees with isDocPath on which of a slice's files count as documentation", () => {
  const worktree = tmpWorktree();
  const files = ["docs/guide.md", "src/gates/sign.ts", "src/core/docs.ts"];
  const docPaths = files.filter(isDocPath);
  assert.deepEqual(docPaths, ["docs/guide.md"], "sanity: isDocPath picks out exactly the docs/ path here");

  // The declared docs/ path does not exist in the landed tree yet — the
  // obligation must be reported unmet, and it must name exactly the path
  // isDocPath called documentation, never a path isDocPath rejected.
  const slice = {
    handle: "SL-1",
    status: "doing",
    files,
    workUnits: [],
  };
  const [note] = docsObligations([slice], worktree);
  assert.ok(note, "the missing doc page is reported");
  assert.match(note, /docs\/guide\.md/, "the gate names the path isDocPath calls documentation");
  assert.doesNotMatch(note, /src\/gates\/sign\.ts/, "a non-doc path is never named as a doc obligation");
  assert.doesNotMatch(note, /src\/core\/docs\.ts/, "a non-doc path is never named as a doc obligation");

  // Once the declared doc path actually lands, the gate is satisfied — the
  // same agreement holds on the positive side.
  fs.mkdirSync(path.join(worktree, "docs"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "docs", "guide.md"), "# guide\n");
  const metNotes = docsObligations([slice], worktree);
  assert.deepEqual(metNotes, [], "landing the doc page the gates agree on satisfies the obligation");
});
