#!/usr/bin/env node
/**
 * Harness for SP-9_SL-1 — a worktree shares its canonical Spec's board.
 *
 * Boots the real server with cwd = a linked worktree (a `.git` *file* pointing
 * at a canonical repo) and proves the worktree session's default board resolves
 * to the canonical repo's CENTRAL namespace — i.e. the worktree carries no board
 * of its own; it reads the same sidecar board as the canonical (AC #3).
 *
 * Build first: `npm run compile`. Run: `node scripts/worktree-board-harness.mjs`.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(
  path.resolve(HERE, ".."),
  "dist",
  "mcp",
  "kanbanMcpServer.js",
);

const tmp = mkdtempSync(path.join(tmpdir(), "wt-board-"));
const wsFolder = path.join(tmp, "ws"); // the "Platform" workspace folder
const canonical = path.join(wsFolder, "extensions", "foo"); // the code repo
const boardRoot = path.join(tmp, "board");
const central = path.join(boardRoot, "Platform", "extensions", "foo"); // its board
const wtBase = path.join(tmp, "foo-worktrees");
const worktree = path.join(wtBase, "SP-1"); // a linked worktree of foo

// canonical repo (a `.git` *dir*), no co-located board
mkdirSync(path.join(canonical, ".git"), { recursive: true });
// its central board, with one slice seeded
mkdirSync(path.join(central, "specs", "SP-1"), { recursive: true });
writeFileSync(
  path.join(central, "specs", "SP-1", "spec.md"),
  `# Foo\n\n## Acceptance Criteria\n\n- [ ] x\n\n## Constraints\n\n- none\n\n## Design\n\n- n/a\n\n## File Structure Plan\n\n- n/a\n`,
);
writeFileSync(
  path.join(central, "specs", "SP-1", "SL-1.md"),
  `---\nuid: canon-seed\nparent: SP-1\nstatus: ready\n---\n\n# Canon seed\n\nLives in the canonical Spec's sidecar board.\n`,
);
// the worktree: a `.git` FILE pointing at the canonical (no board of its own)
mkdirSync(worktree, { recursive: true });
writeFileSync(
  path.join(worktree, ".git"),
  `gitdir: ${canonical}/.git/worktrees/SP-1\n`,
);

const child = spawn(process.execPath, [SERVER], {
  cwd: worktree, // session rooted in the WORKTREE
  env: {
    ...process.env,
    THINKUBE_ALLOW_AI_WRITES: "true",
    THINKUBE_ROOTS: [wsFolder, wtBase].join(path.delimiter),
    THINKUBE_FOLDERS: JSON.stringify([{ name: "Platform", path: wsFolder }]),
    THINKUBE_BOARD_ROOT: boardRoot,
  },
  stdio: ["pipe", "pipe", "inherit"],
});
let buf = "";
const pending = new Map();
child.stdout.on("data", (c) => {
  buf += c.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  }
});
let nextId = 1;
const rpc = (method, params) =>
  new Promise((res, rej) => {
    const i = nextId++;
    pending.set(i, res);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n",
    );
    setTimeout(() => rej(new Error("timeout " + method)), 10_000);
  });

const checks = [];
const record = (label, pass, detail) => {
  checks.push({ label, pass });
  console.log(`${pass ? "  ✅" : "  ❌"} ${label}`);
  if (detail) console.log(`        ${detail}`);
};

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "wt-board", version: "0" },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );

  console.log("\nharness — SP-9_SL-1 worktree shares canonical board\n");

  const r = await rpc("tools/call", { name: "list_board", arguments: {} });
  const text = r.result?.content?.[0]?.text ?? "";
  let ready = [];
  try {
    ready =
      (JSON.parse(text).columns ?? [])
        .find((c) => c.id === "column-ready")
        ?.cards.map((c) => c.id) ?? [];
  } catch {
    /* empty */
  }
  record(
    "a worktree session's default board IS the canonical Spec's sidecar board",
    ready.includes("SP-1_SL-1"),
    `ready=[${ready.join(", ")}]`,
  );

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${passed}/${checks.length} behaviours held\n`);
  child.kill();
  rmSync(tmp, { recursive: true, force: true });
  process.exit(passed === checks.length ? 0 : 1);
} catch (err) {
  console.error(`harness error: ${err.message}`);
  child.kill();
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
