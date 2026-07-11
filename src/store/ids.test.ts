/**
 * Unit tests for the pure scope-sequential id allocator (SP-th8m5b / TEP-th8lzj,
 * AC 1–2). No vscode. The scan-max+1 core is tested over name lists; the scope
 * allocators are tested over real tmp directory trees.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  nextNumberFromNames,
  nextTepNumber,
  nextSpecNumber,
  nextSliceNumber,
} from "./ids";

test("nextNumberFromNames returns scan-max+1, archive-aware, prefix-scoped", () => {
  // Empty scope → the first number is 1.
  assert.equal(nextNumberFromNames([], "TEP"), 1);

  // Highest wins (not the count): a gap from a deleted/retired entry is kept,
  // so a number is never reused.
  assert.equal(nextNumberFromNames(["TEP-1", "TEP-2"], "TEP"), 3);
  assert.equal(nextNumberFromNames(["TEP-1", "TEP-5"], "TEP"), 6); // gap reserved

  // `SL-k.md` slice files are matched (the `.md` suffix is tolerated).
  assert.equal(nextNumberFromNames(["SL-1.md", "SL-2.md"], "SL"), 3);

  // Unrelated siblings never perturb the counter.
  assert.equal(
    nextNumberFromNames(["TEP-1", "tep.md", "SP-9", "SP-1_SL-2"], "TEP"),
    2,
  );
  // Prefix is exact: a `SP-*` is not a `TEP-*`.
  assert.equal(nextNumberFromNames(["SP-1", "SP-2"], "TEP"), 1);
});

/** mkdir -p every path under `root`, then return `root`. */
async function tree(root: string, dirs: string[]): Promise<string> {
  for (const d of dirs) await fs.mkdir(path.join(root, d), { recursive: true });
  return root;
}

test("nextTepNumber is scan-max+1 per (thinking space, org), restarting per scope", async () => {
  const thinkingSpaceA = await fs.mkdtemp(path.join(os.tmpdir(), "ids-thinkingSpaceA-"));
  const thinkingSpaceB = await fs.mkdtemp(path.join(os.tmpdir(), "ids-thinkingSpaceB-"));
  try {
    // Acme has TEP-1, TEP-2 under thinkingSpaceA → next is TEP-3.
    await tree(thinkingSpaceA, ["Acme/teps/TEP-1", "Acme/teps/TEP-2"]);
    assert.equal(await nextTepNumber(thinkingSpaceA, "Acme"), 3);

    // A different org on the SAME thinking space has its own (empty) teps dir → restarts at 1.
    assert.equal(await nextTepNumber(thinkingSpaceA, "Globex"), 1);

    // The SAME org on a DIFFERENT thinking space is independent → restarts at 1.
    assert.equal(await nextTepNumber(thinkingSpaceB, "Acme"), 1);
  } finally {
    await fs.rm(thinkingSpaceA, { recursive: true, force: true });
    await fs.rm(thinkingSpaceB, { recursive: true, force: true });
  }
});

test("nextSpecNumber is scoped to its TEP (restarting at 1 per TEP)", async () => {
  const thinkingSpace = await fs.mkdtemp(path.join(os.tmpdir(), "ids-spec-"));
  try {
    await tree(thinkingSpace, [
      "Acme/teps/TEP-1/SP-1",
      "Acme/teps/TEP-1/SP-2",
      "Acme/teps/TEP-2", // no specs yet
    ]);
    const tep1 = path.join(thinkingSpace, "Acme", "teps", "TEP-1");
    const tep2 = path.join(thinkingSpace, "Acme", "teps", "TEP-2");

    assert.equal(await nextSpecNumber(tep1), 3); // SP-1, SP-2 → SP-3
    assert.equal(await nextSpecNumber(tep2), 1); // independent counter restarts
  } finally {
    await fs.rm(thinkingSpace, { recursive: true, force: true });
  }
});

test("nextSliceNumber is scoped to its spec and archive-aware", async () => {
  const thinkingSpace = await fs.mkdtemp(path.join(os.tmpdir(), "ids-slice-"));
  try {
    const sp1 = path.join(thinkingSpace, "Acme", "teps", "TEP-1", "SP-1");
    const sp2 = path.join(thinkingSpace, "Acme", "teps", "TEP-1", "SP-2");
    await fs.mkdir(sp1, { recursive: true });
    await fs.mkdir(sp2, { recursive: true });

    // SP-1 has SL-1, SL-2 plus the spec doc → next slice is SL-3.
    await fs.writeFile(path.join(sp1, "spec.md"), "");
    await fs.writeFile(path.join(sp1, "SL-1.md"), "");
    await fs.writeFile(path.join(sp1, "SL-2.md"), "");
    assert.equal(await nextSliceNumber(sp1), 3);

    // A retired SL-5 leaves a gap (SL-3, SL-4 never existed); its number stays
    // reserved → next is SL-6, not SL-3.
    await fs.writeFile(path.join(sp1, "SL-5.md"), "");
    assert.equal(await nextSliceNumber(sp1), 6);

    // A different spec under the same TEP has its own counter → restarts at 1.
    assert.equal(await nextSliceNumber(sp2), 1);
  } finally {
    await fs.rm(thinkingSpace, { recursive: true, force: true });
  }
});
