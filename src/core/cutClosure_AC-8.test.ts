/**
 * TRANSITION — docsObligations must read the same definition of a
 * documentation path as the sign gate (isDocumentationPath), not its own
 * docs/ prefix test: before this, a slice whose only doc file was a
 * root-level markdown document (like ENGINE-WIRING.md) was counted as
 * declaring no documentation at all, and refused for an obligation it had
 * actually met.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { docsObligations } from "../run/plan";
import type { SliceForDag } from "../engine/core/dag";

test("docsObligations counts a slice whose only documentation file is a root-level markdown document as declaring documentation", () => {
  // The file is declared but not landed in the worktree. If the root-level
  // markdown file is recognised as documentation, the obligation is seen
  // and reported unmet, naming the missing file. If it is not recognised
  // (the old docs/-prefix-only rule), the slice is read as declaring no
  // documentation at all, and no note is produced — the gap goes unseen.
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-docsobl-"));

  const slice: SliceForDag = {
    handle: "SL-5",
    status: "doing",
    files: ["ENGINE-WIRING.md"],
    workUnits: [],
  };

  const notes = docsObligations([slice], worktree);
  assert.ok(
    notes.some((n) => n.includes("SL-5") && n.includes("ENGINE-WIRING.md")),
    `expected the root-level markdown file to be recognised as a declared, unmet documentation obligation, got: ${JSON.stringify(notes)}`,
  );
});
