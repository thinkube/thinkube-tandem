/**
 * The browser is up and answering before a reviewer exists, or no
 * reviewer is started and the reason is said.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { listeningAt, openTheBrowser, serverHere } from "./theBrowser";

/** A server that says a line and stays up, or exits without saying it. */
function fakeServer(says: string | undefined, exits = false): { start: () => ChildProcess; args: string[][] } {
  const args: string[][] = [];
  return {
    args,
    start: (): ChildProcess => {
      const child = new EventEmitter() as unknown as ChildProcess;
      const out = new EventEmitter();
      const err = new EventEmitter();
      Object.assign(child, { stdout: out, stderr: err, kill: () => undefined });
      setTimeout(() => {
        if (says) err.emit("data", says);
        if (exits) (child as unknown as EventEmitter).emit("exit", 1);
      }, 5);
      return child;
    },
  };
}

test("the address is read from what the server says when it is ready", () => {
  assert.equal(listeningAt("Listening on http://localhost:39217\nPut this in your client config:"), "http://localhost:39217");
  assert.equal(listeningAt("starting up"), undefined);
});

test("a reviewer is given the address of a server that is already answering", async () => {
  const server = fakeServer("Listening on http://localhost:39217\n");
  const r = await openTheBrowser({
    origin: "https://todo.example.com",
    outputDir: "/tmp/looks",
    sessionFile: "/tmp/session.json",
    start: (cmd, ar) => {
      server.args.push(ar);
      return server.start();
    },
  });
  assert.ok("url" in r, JSON.stringify(r));
  assert.equal(r.url, "http://localhost:39217/mcp");
  const ar = server.args[0];
  assert.ok(ar.includes("--allowed-origins") && ar.includes("https://todo.example.com"), ar.join(" "));
  assert.ok(ar.includes("--storage-state") && ar.includes("/tmp/session.json"), ar.join(" "));
  assert.ok(ar.includes("--output-dir") && ar.includes("/tmp/looks"), ar.join(" "));
  r.close();
});

test("a server that stops before it is ready is said, and no address is given back", async () => {
  const server = fakeServer("Error: cannot find browser\n", true);
  const r = await openTheBrowser({
    origin: "https://todo.example.com",
    patienceMs: 2000,
    start: () => server.start(),
  });
  assert.ok("why" in r);
  assert.match(r.why, /stopped before it was ready/);
  assert.match(r.why, /cannot find browser/, "in the server's own words");
});

test("a server that never says anything is given up on, with what it did say", async () => {
  const server = fakeServer(undefined);
  const r = await openTheBrowser({ origin: "https://x.test", patienceMs: 300, start: () => server.start() });
  assert.ok("why" in r);
  assert.match(r.why, /did not answer within/);
});

test("the server is the one this machine has, when it has one", () => {
  const found = serverHere("/nowhere-at-all");
  assert.equal(found.command, "npx", "and only a machine with none fetches one");
});

test("the browser is isolated, because that is where the signed-in session applies", async () => {
  const server = fakeServer("Listening on http://localhost:1\n");
  const seen: string[][] = [];
  await openTheBrowser({
    origin: "https://todo.example.com",
    sessionFile: "/tmp/session.json",
    start: (_c, ar) => {
      seen.push(ar);
      return server.start();
    },
  });
  const ar = seen[0];
  assert.ok(ar.includes("--isolated"), ar.join(" "));
  assert.ok(!ar.includes("--user-data-dir"), "a profile would ignore the session file");
  assert.ok(ar.includes("--storage-state") && ar.includes("/tmp/session.json"), ar.join(" "));
});
