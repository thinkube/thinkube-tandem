import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureCodeGraph, graphifyBin, NoCodeGraph, resetGraphProbe } from "./graph";

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-graph-"));
  execFileSync("git", ["init", "-q", dir]);
  fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
  const g = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  g(["add", "-A"]);
  g(["commit", "-qm", "seed"]);
  return dir;
}

test("no code graph, no derivation — and the refusal says what to install", async () => {
  // The whole point: a machine that cannot read the repository does not
  // derive from a guess about it. There is no quiet degraded mode.
  const was = process.env.THINKUBE_GRAPHIFY_BIN;
  process.env.THINKUBE_GRAPHIFY_BIN = "/nonexistent/graphify";
  resetGraphProbe();
  try {
    await assert.rejects(
      ensureCodeGraph({ repoRoot: tmpRepo(), cacheRoot: fs.mkdtempSync(path.join(os.tmpdir(), "c-")) }),
      (err: Error) => {
        assert.ok(err instanceof NoCodeGraph);
        assert.match(err.message, /not runnable/);
        assert.match(err.message, /uv tool install graphifyy/, "it says how to fix it");
        return true;
      },
    );
  } finally {
    if (was === undefined) delete process.env.THINKUBE_GRAPHIFY_BIN;
    else process.env.THINKUBE_GRAPHIFY_BIN = was;
    resetGraphProbe();
  }
});

test("the binary is named by the environment, so a pinned build can be pointed at", () => {
  const was = process.env.THINKUBE_GRAPHIFY_BIN;
  delete process.env.THINKUBE_GRAPHIFY_BIN;
  assert.equal(graphifyBin(), "graphify");
  process.env.THINKUBE_GRAPHIFY_BIN = "/opt/graphify";
  assert.equal(graphifyBin(), "/opt/graphify");
  if (was === undefined) delete process.env.THINKUBE_GRAPHIFY_BIN;
  else process.env.THINKUBE_GRAPHIFY_BIN = was;
});

test("a directory that is not a repository has no stable identity, and is refused", async () => {
  resetGraphProbe();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-bare-"));
  await assert.rejects(
    ensureCodeGraph({ repoRoot: bare, cacheRoot: fs.mkdtempSync(path.join(os.tmpdir(), "c-")) }),
    (err: Error) => {
      assert.match(err.message, /not a git repository/);
      return true;
    },
  );
});
