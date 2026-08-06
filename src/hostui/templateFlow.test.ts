/**
 * The control-auth parser digs URL + bearer token out of any Claude MCP
 * config shape, and refuses shapes without both.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseControlAuth } from "./templateFlow";

test("finds the control server anywhere in the config; base is the origin", () => {
  const cfg = {
    projects: {
      "/home/u": {
        mcpServers: {
          "thinkube-control": {
            type: "http",
            url: "https://control.example.com/mcp",
            headers: { Authorization: "Bearer tk_abc" },
          },
        },
      },
    },
  };
  assert.deepEqual(parseControlAuth(cfg), { base: "https://control.example.com", token: "tk_abc" });
});

test("no server, no token, or a non-bearer header parse to nothing", () => {
  assert.equal(parseControlAuth({}), undefined);
  assert.equal(parseControlAuth({ "thinkube-control": { url: "https://x.y" } }), undefined);
  assert.equal(
    parseControlAuth({ "thinkube-control": { url: "https://x.y", headers: { Authorization: "token t" } } }),
    undefined,
  );
  assert.equal(parseControlAuth(null), undefined);
});
