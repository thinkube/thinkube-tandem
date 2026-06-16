/**
 * Unit tests for the MCP→host control-request hand-off (SP-tgpwbm AC8). Pure:
 * the request round-trips (serialize → parse) and routes to the startWorktree
 * handler, distinct from other kinds. Run via `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  serializeControlRequest,
  parseControlRequest,
  routeControlRequest,
  startWorktreeRequestFile,
  type ControlRequest,
} from "./controlRequests";

test("a start-worktree request round-trips through serialize → parse", () => {
  const req: ControlRequest = { kind: "start-worktree", spec: "tgpwbm" };
  const round = parseControlRequest(serializeControlRequest(req));
  assert.deepEqual(round, req);
});

test("a start-worktree request routes to the startWorktree handler", () => {
  const calls: { startWorktree: string[] } = { startWorktree: [] };
  const req = parseControlRequest(
    serializeControlRequest({ kind: "start-worktree", spec: "5" }),
  );
  assert.ok(req);
  routeControlRequest(req!, {
    startWorktree: (spec) => {
      calls.startWorktree.push(spec);
      return undefined;
    },
  });
  assert.deepEqual(calls.startWorktree, ["5"]);
});

test("routing returns the handler's value (so a caller can act on it)", () => {
  const req: ControlRequest = { kind: "start-worktree", spec: "9" };
  const out = routeControlRequest(req, {
    startWorktree: (spec) => `opened ${spec}`,
  });
  assert.equal(out, "opened 9");
});

test("parse rejects an unknown control kind (distinct from start-worktree)", () => {
  assert.equal(
    parseControlRequest(JSON.stringify({ kind: "open-team", team: "x" })),
    undefined,
  );
});

test("parse rejects malformed JSON and a kindless object", () => {
  assert.equal(parseControlRequest("not json"), undefined);
  assert.equal(parseControlRequest("{}"), undefined);
  assert.equal(parseControlRequest(JSON.stringify({ spec: "5" })), undefined);
});

test("parse rejects a start-worktree request missing its spec", () => {
  assert.equal(
    parseControlRequest(JSON.stringify({ kind: "start-worktree" })),
    undefined,
  );
  assert.equal(
    parseControlRequest(JSON.stringify({ kind: "start-worktree", spec: "" })),
    undefined,
  );
});

test("the request filename is spec-scoped and stays inside the control dir", () => {
  const f = startWorktreeRequestFile("../escape");
  assert.match(f, /^start-worktree-[0-9a-f]+\.json$/);
  assert.doesNotMatch(f, /\.\.|\//);
  // Distinct specs get distinct files (fire-once per Spec).
  assert.notEqual(startWorktreeRequestFile("5"), startWorktreeRequestFile("6"));
});
