/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A person's act, asked through the client.
 *
 * With a client that can ask the person, a tool that is theirs does not
 * come back refused: the server asks, and their answer decides. This
 * starts the real process and speaks MCP to it, answering the server's
 * elicitation request the way a client would.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { putCard } from "../core/cards";
import { confirmation, confirmed } from "./boundary";

test("the question says whose act it is and what the agent asked, and only an accepted yes is a yes", () => {
  const q = confirmation("build", "build", { space: "a-space", set: "S-1" });
  assert.match(q.message, /Build/);
  assert.match(q.message, /build \(space: a-space, set: S-1\)/);
  assert.match(q.message, /yours to decide/);
  assert.equal(q.requestedSchema.properties.yes.type, "boolean");
  assert.equal(confirmed({ action: "accept", content: { yes: true } }), true);
  assert.equal(confirmed({ action: "accept", content: { yes: false } }), false);
  assert.equal(confirmed({ action: "accept" }), false);
  assert.equal(confirmed({ action: "decline" }), false);
  assert.equal(confirmed({ action: "cancel", content: { yes: true } }), false);
});

/** A client that answers the server's questions the way the person would. */
function client(proc: ReturnType<typeof spawn>, person: (message: string) => { action: string; content?: Record<string, unknown> }) {
  let buf = "";
  const waiting = new Map<number, (v: Record<string, unknown>) => void>();
  const asked: string[] = [];
  proc.stdout!.on("data", (d: Buffer) => {
    buf += d.toString("utf8");
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; method?: string; params?: { message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.method === "elicitation/create" && typeof msg.id === "number") {
        asked.push(msg.params?.message ?? "");
        const result = person(msg.params?.message ?? "");
        proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`);
        continue;
      }
      if (typeof msg.id === "number" && !msg.method) waiting.get(msg.id)?.(msg as Record<string, unknown>);
    }
  });
  let id = 0;
  return {
    asked,
    call(method: string, params: unknown, ms = 20_000): Promise<Record<string, unknown>> {
      const mine = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${method} got no reply in ${ms}ms`)), ms);
        waiting.set(mine, (v) => {
          clearTimeout(timer);
          resolve(v);
        });
        proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: mine, method, params })}\n`);
      });
    },
  };
}

function world(): { repo: string; store: string; space: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ask-repo-"));
  execFileSync("git", ["-C", repo, "init", "-q"], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:t/asked.git"], { stdio: "ignore" });
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ask-store-"));
  putCard(store, { id: "asked-1", label: "Asked", remote: "git@github.com:t/asked.git", prefix: "" });
  const space = "a-space";
  fs.mkdirSync(path.join(store, "spaces", "asked-1", space), { recursive: true });
  return { repo, store, space };
}

const spawned: ReturnType<typeof spawn>[] = [];
after(() => {
  for (const p of spawned) p.kill("SIGKILL");
});

async function serverAsking(person: (message: string) => { action: string; content?: Record<string, unknown> }) {
  const w = world();
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js"), "--repo", w.repo], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TANDEM_STORE: w.store, TANDEM_AUTONOMOUS: "", GIT_AUTHOR_EMAIL: "t@example.com", EMAIL: "t@example.com" },
  });
  spawned.push(proc);
  const c = client(proc, person);
  await c.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: { elicitation: {} },
    clientInfo: { name: "drive", version: "1" },
  });
  return { w, c };
}

test("a person's act is asked of the person, and their no is the answer", { timeout: 30_000 }, async () => {
  const { w, c } = await serverAsking(() => ({ action: "decline" }));
  const res = (await c.call("tools/call", { name: "build", arguments: { space: w.space } })) as {
    result?: { isError?: boolean; content?: { text: string }[] };
  };
  assert.equal(c.asked.length, 1, "the person was asked once");
  assert.match(c.asked[0], /yours to decide/);
  assert.equal(res.result?.isError, true);
  assert.match(res.result?.content?.[0].text ?? "", /did not say yes, so nothing was done/);
});

test("their yes opens the gate: the call goes on to the space, past the boundary", { timeout: 30_000 }, async () => {
  const { w, c } = await serverAsking(() => ({ action: "accept", content: { yes: true } }));
  const res = (await c.call("tools/call", { name: "build", arguments: { space: w.space } })) as {
    result?: { isError?: boolean; content?: { text: string }[] };
  };
  assert.equal(c.asked.length, 1);
  const text = res.result?.content?.[0].text ?? "";
  assert.doesNotMatch(text, /yours, not mine/, "the boundary no longer refuses it");
  assert.doesNotMatch(text, /did not say yes/);
});

test("the server offers its flows as prompts, and a prompt names the space it works in", { timeout: 30_000 }, async () => {
  const { w, c } = await serverAsking(() => ({ action: "decline" }));
  const list = (await c.call("prompts/list", {})) as { result?: { prompts?: { name: string }[] } };
  const names = (list.result?.prompts ?? []).map((p) => p.name);
  assert.deepEqual(names, ["capture-asks", "build", "review-delivery"]);
  const got = (await c.call("prompts/get", { name: "build", arguments: { space: w.space } })) as {
    result?: { messages?: { content: { text: string } }[] };
  };
  assert.match(got.result?.messages?.[0].content.text ?? "", /"a-space"/);
  assert.match(got.result?.messages?.[0].content.text ?? "", /`check_readiness`/);
});
