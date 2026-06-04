#!/usr/bin/env node
/**
 * stdio harness for the SP-6 → Done AC-checked gate.
 *
 * Spawns the *real* kanban MCP server (`dist/mcp/kanbanMcpServer.js`) over its
 * JSON-RPC stdio transport — not the pure gate function — so it proves the gate
 * is actually wired into `move_slice`, errors surface as tool errors, and the
 * legacy skip path returns its marker. Demonstrates, end-to-end:
 *
 *   1. move → Done is REFUSED while a satisfied AC is unchecked (error names it)
 *   2. move → Done is ALLOWED once that AC is checked on the Spec
 *   3. a legacy slice (no `satisfies`) passes ungated with gateSkipped
 *
 * Build first: `npm run compile` (or `tsc -p ./`). Run: `node scripts/ac-gate-harness.mjs`.
 * Exit 0 = all three behaviours held; non-zero = a behaviour regressed.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SERVER = path.join(REPO, "dist", "mcp", "kanbanMcpServer.js");

// ── temp board: a dir with a committed-shape .thinkube/ (no git needed) ──
const board = mkdtempSync(path.join(tmpdir(), "ac-gate-board-"));
const specDir = path.join(board, ".thinkube", "specs", "SP-1");
mkdirSync(specDir, { recursive: true });
const specPath = path.join(specDir, "spec.md");
const specWith = (firstChecked) => `# Harness spec

A spec for exercising the → Done gate.

## Acceptance Criteria

- [${firstChecked ? "x" : " "}] First criterion — the gated one
- [x] Second criterion — already done

## Constraints

- none

## Design

- n/a

## File Structure Plan

- n/a
`;
writeFileSync(specPath, specWith(false));

// ── minimal JSON-RPC-over-stdio client (MCP uses newline-delimited JSON) ──
const child = spawn(process.execPath, [SERVER], {
  cwd: board,
  env: {
    ...process.env,
    THINKUBE_ALLOW_AI_WRITES: "true",
    THINKUBE_ROOTS: board,
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
      continue; // ignore any non-JSON noise
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
    clientInfo: { name: "ac-gate-harness", version: "0" },
  });
  notify("notifications/initialized", {});

  console.log("\nstdio harness — SP-6 → Done AC-checked gate\n");

  // Slice that satisfies AC #1 (the unchecked one).
  const c1 = await callTool("create_slice", {
    spec: 1,
    title: "Gated slice satisfying AC 1",
    body: "Exercises the gate.",
    satisfies: [1],
  });
  const gatedHandle = JSON.parse(c1.text).slice; // SP-1_SL-1
  record(
    `create_slice satisfies:[1] → ${gatedHandle}`,
    !c1.isError && gatedHandle === "SP-1_SL-1",
  );

  // 1. refuse while AC #1 unchecked.
  const m1 = await callTool("move_slice", {
    slice: gatedHandle,
    status: "Done",
  });
  record(
    "move → Done REFUSED while AC #1 unchecked (error names #1)",
    m1.isError && /#1/.test(m1.text) && /First criterion/.test(m1.text),
    m1.text,
  );

  // 2. check AC #1 on the Spec, then allow.
  writeFileSync(specPath, specWith(true));
  const m2 = await callTool("move_slice", {
    slice: gatedHandle,
    status: "Done",
  });
  const m2ok = !m2.isError && JSON.parse(m2.text).status === "done";
  record(
    "move → Done ALLOWED once AC #1 is checked",
    m2ok,
    m2.text.replace(/\s+/g, " ").slice(0, 160),
  );

  // 3. legacy slice (no satisfies) passes with gateSkipped.
  const c2 = await callTool("create_slice", {
    spec: 1,
    title: "Legacy slice without satisfies",
    body: "No satisfies field.",
  });
  const legacyHandle = JSON.parse(c2.text).slice; // SP-1_SL-2
  record(`create_slice (no satisfies) → ${legacyHandle}`, !c2.isError);
  const m3 = await callTool("move_slice", {
    slice: legacyHandle,
    status: "Done",
  });
  const m3parsed = m3.isError ? {} : JSON.parse(m3.text);
  record(
    'legacy slice → Done passes ungated with gateSkipped: "no satisfies field"',
    !m3.isError && m3parsed.gateSkipped === "no satisfies field",
    m3.text.replace(/\s+/g, " ").slice(0, 160),
  );

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${passed}/${checks.length} behaviours held\n`);
  child.kill();
  rmSync(board, { recursive: true, force: true });
  process.exit(passed === checks.length ? 0 : 1);
} catch (err) {
  console.error(`harness error: ${err.message}`);
  child.kill();
  rmSync(board, { recursive: true, force: true });
  process.exit(2);
}
