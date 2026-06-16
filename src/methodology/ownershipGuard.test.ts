/**
 * Exit-code tests for the PreToolUse(Edit|Write) ownership guard hook
 * (SP-tgpwbm AC4). The shipped hook is a standalone Node script in the
 * methodology bundle; here we run it as a subprocess against owned / unowned
 * fixtures and assert exit 0 (allow) / exit 2 (block) — a hook exit-code AC
 * (TEP-tgnvkw). Run via `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// npm test runs from the package root, so the bundle script resolves off cwd.
const HOOK = path.join(
  process.cwd(),
  "templates/methodology-bundle/hooks/ownership-guard.mjs",
);

function writeJournal(claims: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tk-own-"));
  const file = path.join(dir, "ownership-claims.json");
  writeFileSync(file, JSON.stringify({ version: 1, claims }, null, 2));
  return file;
}

interface RunOpts {
  filePath?: string;
  toolName?: string;
  activeSlice?: string;
  journal?: string;
}

function runHook(opts: RunOpts): number {
  const input = JSON.stringify({
    tool_name: opts.toolName ?? "Edit",
    tool_input: opts.filePath ? { file_path: opts.filePath } : {},
  });
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.activeSlice !== undefined)
    env.THINKUBE_ACTIVE_SLICE = opts.activeSlice;
  else delete env.THINKUBE_ACTIVE_SLICE;
  if (opts.journal) env.THINKUBE_OWNERSHIP_JOURNAL = opts.journal;
  const r = spawnSync("node", [HOOK], { input, env, encoding: "utf8" });
  if (r.status === null) throw new Error(`hook did not exit: ${r.error}`);
  return r.status;
}

test("owned file: the active slice may edit a file it owns → exit 0", () => {
  const journal = writeJournal({ "src/a.ts": "SP-9_SL-1" });
  assert.equal(
    runHook({
      filePath: "src/a.ts",
      activeSlice: "SP-9_SL-1",
      journal,
    }),
    0,
  );
});

test("unowned file: a file owned by another slice is refused → exit 2", () => {
  const journal = writeJournal({
    "src/a.ts": "SP-9_SL-1",
    "src/b.ts": "SP-9_SL-2",
  });
  assert.equal(
    runHook({
      filePath: "src/b.ts",
      activeSlice: "SP-9_SL-1",
      journal,
    }),
    2,
  );
});

test("unclaimed file while the slice holds a claim is refused → exit 2", () => {
  const journal = writeJournal({ "src/a.ts": "SP-9_SL-1" });
  assert.equal(
    runHook({
      filePath: "src/elsewhere.ts",
      activeSlice: "SP-9_SL-1",
      journal,
    }),
    2,
  );
});

test("a leading ./ on the target is normalized before the ownership lookup", () => {
  const journal = writeJournal({ "src/a.ts": "SP-9_SL-1" });
  assert.equal(
    runHook({ filePath: "./src/a.ts", activeSlice: "SP-9_SL-1", journal }),
    0,
  );
});

test("not engaged: no active slice → allow (exit 0)", () => {
  const journal = writeJournal({ "src/a.ts": "SP-9_SL-1" });
  assert.equal(runHook({ filePath: "src/a.ts", journal }), 0);
});

test("not engaged: the active slice holds no claims → allow (exit 0)", () => {
  const journal = writeJournal({ "src/a.ts": "SP-9_SL-1" });
  assert.equal(
    runHook({ filePath: "src/a.ts", activeSlice: "SP-9_SL-99", journal }),
    0,
  );
});

test("a non-editing tool is never blocked → exit 0", () => {
  const journal = writeJournal({ "src/a.ts": "SP-9_SL-1" });
  assert.equal(
    runHook({
      toolName: "Read",
      filePath: "src/b.ts",
      activeSlice: "SP-9_SL-1",
      journal,
    }),
    0,
  );
});

test("an absolute file_path is relativized against THINKUBE_REPO_ROOT", () => {
  const journal = writeJournal({ "src/a.ts": "SP-9_SL-1" });
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: "/repo/src/a.ts" },
    }),
    env: {
      ...process.env,
      THINKUBE_ACTIVE_SLICE: "SP-9_SL-1",
      THINKUBE_OWNERSHIP_JOURNAL: journal,
      THINKUBE_REPO_ROOT: "/repo",
    },
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
});
