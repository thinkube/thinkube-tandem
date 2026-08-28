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
import { after, test } from "node:test";
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
    /**
     * Every call is BOUNDED. A drive that waits forever for a reply does
     * not fail — it hangs, and takes the whole suite with it. A server
     * that does not answer in two seconds is broken — the whole file runs
     * in well under one — and saying so is the drive's job.
     */
    call(method: string, params: unknown, ms = 2000): Promise<Record<string, unknown>> {
      const mine = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${method} got no reply in ${ms}ms — the server is not answering`)),
          ms,
        );
        waiting.set(mine, (v) => {
          clearTimeout(timer);
          resolve(v);
        });
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
    [path.join(__dirname, "server.js"), "--repo", w.repo],
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

/** One server for the whole file: spawning a process per drive multiplies
 *  the slowest part of the file by the number of claims it makes. */
let shared: { w: ReturnType<typeof world>; proc: ReturnType<typeof spawn>; c: ReturnType<typeof client> } | undefined;
async function running() {
  if (!shared) {
    const w = world();
    const { proc, c } = await serverFor(w);
    shared = { w, proc, c };
  }
  return shared;
}
after(() => shared?.proc.kill());

test("the server lists its tools and none of them is a gate", { timeout: 5000 }, async () => {
  const { c } = await running();
  {
    const res = (await c.call("tools/list", {})) as {
      result?: { tools?: { name: string }[] };
    };
    const names = (res.result?.tools ?? []).map((t) => t.name);
    assert.ok(names.includes("read_space"), `expected read_space, got ${names.join(", ")}`);
    assert.ok(names.includes("save_draft"));
    assert.ok(names.includes("list_spaces"), "a server must be able to say what spaces exist");
    for (const gate of ["build", "sign", "accept_delivery", "keep_draft"])
      assert.equal(names.includes(gate), false, `${gate} must not be offered`);
  }
});

test("a tool the boundary does not know is refused through the protocol", { timeout: 5000 }, async () => {
  const { c } = await running();
  {
    const res = (await c.call("tools/call", { name: "build", arguments: {} })) as {
      result?: { isError?: boolean; content?: { text: string }[] };
    };
    assert.equal(res.result?.isError, true);
    assert.match(res.result?.content?.[0].text ?? "", /no such tool|yours|not declared/);
  }
});

test("drafting through the server writes a record the store can be read back from", { timeout: 5000 }, async () => {
  const { w, c } = await running();
  {
    const before = (await c.call("tools/call", { name: "read_space", arguments: { space: w.space } })) as {
      result?: { content?: { text: string }[] };
    };
    assert.match(before.result?.content?.[0].text ?? "", /space: Thing/);

    await c.call("tools/call", {
      name: "save_draft",
      arguments: { space: w.space, text: "the toolbar has no clear button\nthe log panel opens empty" },
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
  }
});
