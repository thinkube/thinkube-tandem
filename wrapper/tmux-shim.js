#!/usr/bin/env node
/**
 * Fake-`tmux` CLI client for Claude Code agent teams (SP-tgnb5o_SL-1).
 *
 * Claude Code (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1) shells out to `tmux`
 * for its display backend. When this shim is on PATH as `tmux`, each
 * invocation forwards its argv to the long-lived AgentTeamsShimServer running
 * in the VS Code Extension Host (which owns the PTYs + terminal panes), over
 * the unix socket / named pipe published in THINKUBE_TMUX_SHIM_SOCK. The
 * server replies with {stdout, exitCode}; we reproduce them so Claude sees a
 * normal `tmux` result.
 *
 * Dependency-free (Node stdlib only): it ships verbatim to dist/wrapper/.
 */
"use strict";
const net = require("node:net");

const sock = process.env.THINKUBE_TMUX_SHIM_SOCK;
if (!sock) {
  process.stderr.write(
    "thinkube tmux-shim: THINKUBE_TMUX_SHIM_SOCK not set " +
      "(is the Thinkube AI extension active?)\n",
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const conn = net.createConnection(sock);
let buf = "";

conn.on("connect", () => {
  conn.write(JSON.stringify({ argv }) + "\n");
});
conn.on("data", (chunk) => {
  buf += chunk.toString("utf8");
});
conn.on("end", () => finish());
conn.on("close", () => finish());
conn.on("error", (err) => {
  process.stderr.write(`thinkube tmux-shim: ${err.message}\n`);
  process.exit(1);
});

let done = false;
function finish() {
  if (done) return;
  done = true;
  const nl = buf.indexOf("\n");
  const line = nl === -1 ? buf : buf.slice(0, nl);
  if (!line) {
    process.exit(0);
  }
  try {
    const res = JSON.parse(line);
    if (typeof res.stdout === "string" && res.stdout.length) {
      process.stdout.write(res.stdout);
    }
    process.exit(typeof res.exitCode === "number" ? res.exitCode : 0);
  } catch (err) {
    process.stderr.write(`thinkube tmux-shim: bad response: ${err.message}\n`);
    process.exit(1);
  }
}
