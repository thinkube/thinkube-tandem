/**
 * IPC-roundtrip integration test (SP-tgnb5o_SL-3, AC#4 mechanism).
 *
 * Exercises the real on-PATH shim CLI (wrapper/tmux-shim.js) end-to-end: it
 * connects over a unix socket to the shared `createTmuxShimServer` framing and
 * a `TmuxRegistry` backed by a recording fake pane. This proves the full wire
 * path — argv → socket → dispatch → response → CLI exit — and, crucially for
 * AC#4, that `send-keys` input is routed to the *correct* teammate's PTY. The
 * live VS Code pane rendering is the recorded acceptance-gate exception.
 *
 * Run via `npm test`. Uses async execFile so the in-process server's event
 * loop keeps serving while the child CLI runs (a sync child would deadlock).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { TmuxRegistry, type Pane, type PaneFactory } from "./tmuxDispatcher";
import { createTmuxShimServer } from "./ipcServer";

const pexec = promisify(execFile);

// wrapper/tmux-shim.js lives at the repo root; the compiled test runs from
// out-test/services/agentTeams, so walk back up three levels.
const SHIM_CLI = path.resolve(__dirname, "../../..", "wrapper", "tmux-shim.js");

interface RecordingPane extends Pane {
  writes: string[];
}

class RecordingFactory implements PaneFactory {
  panes = new Map<string, RecordingPane>();
  spawn(spec: { paneId: string }): Pane {
    const pane: RecordingPane = {
      id: spec.paneId,
      writes: [],
      write(d) {
        this.writes.push(d);
      },
      kill() {},
    };
    this.panes.set(spec.paneId, pane);
    return pane;
  }
}

test("shim CLI round-trips through the socket and routes send-keys to the right pane", async () => {
  const factory = new RecordingFactory();
  const registry = new TmuxRegistry(factory, () => {});
  const server = createTmuxShimServer(registry);

  const sock = path.join(os.tmpdir(), `tmux-shim-it-${process.pid}.sock`);
  fs.rmSync(sock, { force: true });
  await new Promise<void>((resolve) => server.listen(sock, resolve));

  const env = { ...process.env, THINKUBE_TMUX_SHIM_SOCK: sock };
  const run = async (args: string[]) => {
    try {
      const { stdout } = await pexec("node", [SHIM_CLI, ...args], { env });
      return { stdout, code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; code?: number };
      return { stdout: err.stdout ?? "", code: err.code ?? 0 };
    }
  };

  // Claude prefixes the socket before every subcommand (captured).
  const G = ["-S", "/tmp/tmux-1000/default"];
  try {
    // Real flow: split the leader (%0) into empty shell panes for the teammates.
    const p1 = (
      await run([
        ...G,
        "split-window",
        "-t",
        "%0",
        "-h",
        "-l",
        "70%",
        "-P",
        "-F",
        "#{pane_id}",
      ])
    ).stdout.trim();
    const p2 = (
      await run([
        ...G,
        "split-window",
        "-t",
        "%1",
        "-v",
        "-P",
        "-F",
        "#{pane_id}",
      ])
    ).stdout.trim();
    assert.equal(p1, "%1"); // %0 is the leader; teammates are %1, %2
    assert.equal(p2, "%2");

    // Type each teammate's launch command into its pane (the real mechanism).
    await run([...G, "send-keys", "-t", "%1", "-l", "--", "launch agent-1"]);
    await run([...G, "send-keys", "-t", "%1", "Enter"]);
    await run([...G, "send-keys", "-t", "%2", "-l", "--", "launch agent-2"]);

    assert.deepEqual(factory.panes.get("%1")!.writes, ["launch agent-1", "\r"]);
    assert.deepEqual(factory.panes.get("%2")!.writes, ["launch agent-2"]);

    // has-session over the wire: the leader session exists; a ghost doesn't.
    assert.equal((await run([...G, "has-session", "-t", "default"])).code, 0);
    assert.equal((await run([...G, "has-session", "-t", "ghost"])).code, 1);

    // client_control_mode stays empty over the wire (stays off iTerm2 -CC).
    assert.equal(
      (await run([...G, "display-message", "-p", "#{client_control_mode}"]))
        .stdout,
      "",
    );
  } finally {
    server.close();
    fs.rmSync(sock, { force: true });
  }
});
