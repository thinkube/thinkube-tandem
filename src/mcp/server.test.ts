/**
 * The server, driven the way a client drives it.
 *
 * A unit test of a handler proves nothing about a server: the thing that
 * fails in practice is the wiring — a transport that never connects, a
 * tool table the client cannot read, a boundary consulted after the
 * session was already touched. So this starts the REAL process, speaks
 * MCP to it over stdio, and reads what comes back.
 *
 * The two claims that matter: a person's gate is refused through the
 * protocol, not merely absent from the table; and a tool that writes
 * actually changes the store on disk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { putCard } from "../core/cards";

/** A speaking client: writes framed JSON-RPC, reads replies by id. */
function client(proc: ReturnType<typeof spawn>) {
  let buf = "";
  const waiting = new Map<number, (v: Record<string, unknown>) => void>();
  proc.stdout!.on("data", (d: Buffer) => {
    buf += d.toString("utf8");
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: number };
        if (typeof msg.id === "number") waiting.get(msg.id)?.(msg as Record<string, unknown>);
      } catch {
        /* not a frame we asked for */
      }
    }
  });
  let id = 0;
  return {
    call(method: string, params: unknown): Promise<Record<string, unknown>> {
      const mine = ++id;
      return new Promise((resolve) => {
        waiting.set(mine, resolve);
        proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: mine, method, params })}\n`);
      });
    },
  };
}

/** An enabled project with one thinking space, on disk. */
function world(): { repo: string; store: string; space: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-repo-"));
  execFileSync("git", ["-C", repo, "init", "-q"], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:t/thing.git"], {
    stdio: "ignore",
  });
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-store-"));
  putCard(store, { id: "thing-1", label: "Thing", remote: "git@github.com:t/thing.git", prefix: "" });
  const space = "a-space";
  fs.mkdirSync(path.join(store, "spaces", "thing-1", space), { recursive: true });
  return { repo, store, space };
}

async function serverFor(w: ReturnType<typeof world>) {
  const proc = spawn(
    process.execPath,
    [path.join(__dirname, "server.js"), "--repo", w.repo, "--space", w.space],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TANDEM_STORE: w.store,
        GIT_AUTHOR_EMAIL: "tester@example.com",
        EMAIL: "tester@example.com",
      },
    },
  );
  const c = client(proc);
  await c.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "drive", version: "1" },
  });
  return { proc, c };
}

test("the server lists its tools and none of them is a gate", async () => {
  const w = world();
  const { proc, c } = await serverFor(w);
  try {
    const res = (await c.call("tools/list", {})) as {
      result?: { tools?: { name: string }[] };
    };
    const names = (res.result?.tools ?? []).map((t) => t.name);
    assert.ok(names.includes("read_space"), `expected read_space, got ${names.join(", ")}`);
    assert.ok(names.includes("save_draft"));
    for (const gate of ["build", "sign", "accept_delivery", "keep_draft"])
      assert.equal(names.includes(gate), false, `${gate} must not be offered`);
  } finally {
    proc.kill();
  }
});

test("a tool the boundary does not know is refused through the protocol", async () => {
  const w = world();
  const { proc, c } = await serverFor(w);
  try {
    const res = (await c.call("tools/call", { name: "build", arguments: {} })) as {
      result?: { isError?: boolean; content?: { text: string }[] };
    };
    assert.equal(res.result?.isError, true);
    assert.match(res.result?.content?.[0].text ?? "", /no such tool|yours|not declared/);
  } finally {
    proc.kill();
  }
});

test("drafting through the server writes a record the store can be read back from", async () => {
  const w = world();
  const { proc, c } = await serverFor(w);
  try {
    const before = (await c.call("tools/call", { name: "read_space", arguments: {} })) as {
      result?: { content?: { text: string }[] };
    };
    assert.match(before.result?.content?.[0].text ?? "", /space: Thing/);

    await c.call("tools/call", {
      name: "save_draft",
      arguments: { text: "the toolbar has no clear button\nthe log panel opens empty" },
    });

    // The author segment is the person's git identity, resolved by the
    // session — the drive must not assume how it spells.
    const spaceDir = path.join(w.store, "spaces", "thing-1", w.space);
    const authors = fs.existsSync(spaceDir) ? fs.readdirSync(spaceDir) : [];
    const withRecords = authors.filter((a) => fs.existsSync(path.join(spaceDir, a, "records")));
    assert.ok(
      withRecords.length > 0,
      `drafting must append a record; space holds: ${authors.join(", ") || "nothing"}`,
    );
    const records = path.join(spaceDir, withRecords[0], "records");
    assert.ok(fs.readdirSync(records).length > 0, "at least one record on disk");
  } finally {
    proc.kill();
  }
});
