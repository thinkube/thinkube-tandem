/**
 * The one wait, and what Stop does to a command that is already running.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitOrStop } from "./waiting";
import { runBounded } from "../engine/core/closingGate";

test("a wait ends the moment Stop is pressed, not when its time is up", async () => {
  const stop = new AbortController();
  const began = Date.now();
  setTimeout(() => stop.abort(), 30).unref?.();
  const r = await waitOrStop(60_000, stop.signal);
  assert.equal(r.waited, false, "it says it was stopped rather than that it waited");
  assert.ok(Date.now() - began < 5_000, "and it answers at once, not in a minute");
});

test("a wait that is already stopped never starts", async () => {
  const stop = new AbortController();
  stop.abort();
  assert.deepEqual(await waitOrStop(60_000, stop.signal), { waited: false });
});

test("a wait with nothing to hear still waits", async () => {
  assert.deepEqual(await waitOrStop(10), { waited: true });
});

test("Stop kills a command that is already running — refusing to start one is not stopping", async () => {
  const stop = new AbortController();
  const began = Date.now();
  setTimeout(() => stop.abort(), 100).unref?.();
  const r = await runBounded("sleep 60", process.cwd(), {
    timeoutMs: 60_000,
    env: process.env,
    stop: stop.signal,
  });
  assert.ok(Date.now() - began < 10_000, `it came back at once (${Date.now() - began}ms)`);
  assert.match(r.output, /stopped — the run was halted/, "and says why it ended");
});
