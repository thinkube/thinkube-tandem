#!/usr/bin/env node
/**
 * stdio harness for SP-8_SL-1 — reading/writing a board from a central root.
 *
 * Spawns the real kanban MCP server with a central board root (no co-located
 * `.thinkube/` in the code repo) and proves, end-to-end:
 *
 *   1. the server DISCOVERS the board at `<board-root>/<container>/<rel>` and
 *      list_board reads its seeded slice (AC #1, #3)
 *   2. create_slice WRITES under that central namespace, and the code repo
 *      stays clean — no `.thinkube/` appears in it (AC #2)
 *
 * Build first: `npm run compile`. Run: `node scripts/central-board-harness.mjs`.
 * Exit 0 = all behaviours held.
 */
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SERVER = path.join(REPO, "dist", "mcp", "kanbanMcpServer.js");

// ── temp layout: a "Platform" workspace folder holding a code repo with a
//    .git but NO .thinkube; a separate central board root holding its board ──
const tmp = mkdtempSync(path.join(tmpdir(), "central-board-"));
const wsFolder = path.join(tmp, "ws"); // the "Platform" workspace folder
const repo = path.join(wsFolder, "extensions", "foo"); // the code repo
const boardRoot = path.join(tmp, "board"); // the central sidecar root
const ns = path.join("Platform", "extensions", "foo"); // <container>/<rel>
const boardDir = path.join(boardRoot, ns);
const specDir = path.join(boardDir, "specs", "SP-1");

mkdirSync(path.join(repo, ".git"), { recursive: true }); // repo, no .thinkube
mkdirSync(specDir, { recursive: true });
writeFileSync(
  path.join(specDir, "spec.md"),
  `# Foo spec\n\nA seeded central board.\n\n## Acceptance Criteria\n\n- [ ] something\n\n## Constraints\n\n- none\n\n## Design\n\n- n/a\n\n## File Structure Plan\n\n- n/a\n`,
);
writeFileSync(
  path.join(specDir, "SL-1.md"),
  `---\nuid: seed-slice\nparent: SP-1\nstatus: ready\n---\n\n# Seed slice\n\nSeeded directly in the central board dir.\n`,
);

// A SECOND Thinking Space under a different container ("Apps") — proves two
// spaces are discovered together from the one board root (AC #3), and that the
// container is host-agnostic (Apps would be a Gitea repo in thinkube).
const appsFolder = path.join(tmp, "apps");
const repo2 = path.join(appsFolder, "bar");
const specDir2 = path.join(boardRoot, "Apps", "bar", "specs", "SP-1");
mkdirSync(path.join(repo2, ".git"), { recursive: true });
mkdirSync(specDir2, { recursive: true });
writeFileSync(
  path.join(specDir2, "spec.md"),
  `# Bar spec\n\n## Acceptance Criteria\n\n- [ ] x\n\n## Constraints\n\n- none\n\n## Design\n\n- n/a\n\n## File Structure Plan\n\n- n/a\n`,
);
writeFileSync(
  path.join(specDir2, "SL-1.md"),
  `---\nuid: bar-seed\nparent: SP-1\nstatus: ready\n---\n\n# Bar seed\n\nSeeded in the Apps/bar central board.\n`,
);

const child = spawn(process.execPath, [SERVER], {
  cwd: repo, // session cwd = the code repo → default board resolves to it
  env: {
    ...process.env,
    THINKUBE_ALLOW_AI_WRITES: "true",
    THINKUBE_ROOTS: [wsFolder, appsFolder].join(path.delimiter),
    THINKUBE_FOLDERS: JSON.stringify([
      { name: "Platform", path: wsFolder },
      { name: "Apps", path: appsFolder },
    ]),
    THINKUBE_BOARD_ROOT: boardRoot,
  },
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
    setTimeout(
      () => reject(new Error(`timeout waiting for ${method}`)),
      10_000,
    );
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}
async function callTool(name, args) {
  const res = await rpc("tools/call", { name, arguments: args });
  const result = res.result ?? {};
  const text = (result.content?.[0]?.text ?? "").toString();
  return { isError: !!result.isError, text };
}

const checks = [];
const record = (label, pass, detail) => {
  checks.push({ label, pass });
  console.log(`${pass ? "  ✅" : "  ❌"} ${label}`);
  if (detail) console.log(`        ${detail.replace(/\n/g, "\n        ")}`);
};

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "central-board-harness", version: "0" },
  });
  notify("notifications/initialized", {});

  console.log("\nstdio harness — SP-8_SL-1 central-root board\n");

  // 1. list_board (default = the cwd repo) reads the slice seeded in the
  //    central namespace dir — proving discovery + read come from the root.
  const lb = await callTool("list_board", {});
  let ready = [];
  try {
    ready =
      (JSON.parse(lb.text).columns ?? [])
        .find((c) => c.id === "column-ready")
        ?.cards.map((c) => c.id) ?? [];
  } catch {
    /* leave empty → fails below */
  }
  record(
    "list_board reads the seeded slice from <board-root>/Platform/extensions/foo",
    !lb.isError && ready.includes("SP-1_SL-1"),
    `ready=[${ready.join(", ")}]`,
  );

  // 2. create_slice writes under the central namespace; the code repo stays
  //    clean (no .thinkube/ ever appears in it).
  const cs = await callTool("create_slice", {
    spec: 1,
    title: "Written to the central namespace",
    body: "Should land under the board root, not the code repo.",
  });
  const handle = cs.isError ? "" : JSON.parse(cs.text).slice;
  const wroteCentral = existsSync(path.join(specDir, "SL-2.md"));
  const repoClean = !existsSync(path.join(repo, ".thinkube"));
  record(
    "create_slice writes to the central namespace (SL-2.md under board root)",
    !cs.isError && handle === "SP-1_SL-2" && wroteCentral,
    `handle=${handle} wroteCentral=${wroteCentral}`,
  );
  record(
    "the code repo stays clean — no .thinkube/ written into it (AC #2)",
    repoClean,
    `repo=${repo}`,
  );

  // 4. both Thinking Spaces are discovered from the single board root (AC #3).
  const lbs = await callTool("list_boards", {});
  const bothFound =
    !lbs.isError &&
    lbs.text.includes(path.resolve(repo)) &&
    lbs.text.includes(path.resolve(repo2));
  record(
    "list_boards finds both spaces (Platform/extensions/foo + Apps/bar) from one root (AC #3)",
    bothFound,
    lbs.text.replace(/\s+/g, " ").slice(0, 200),
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
