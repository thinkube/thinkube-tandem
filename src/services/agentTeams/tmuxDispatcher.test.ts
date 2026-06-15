/**
 * Unit tests for the pure agent-teams `tmux` dispatcher (SP-tgnb5o).
 * Run via `npm test`. A fake PaneFactory records spawns + writes, so the
 * CAPTURED command surface (global `-S`, leader/window model, shell panes, the
 * split → send-keys teammate-launch flow) is verifiable headlessly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TmuxRegistry,
  parseTmuxArgs,
  renderFormat,
  __resetPaneSeqForTests,
  type Pane,
  type PaneFactory,
  type TeammateSpec,
} from "./tmuxDispatcher";

interface FakePane extends Pane {
  spec: TeammateSpec;
  writes: string[];
  killed: boolean;
}

class FakeFactory implements PaneFactory {
  panes: FakePane[] = [];
  spawn(spec: TeammateSpec): Pane {
    const pane: FakePane = {
      id: spec.paneId,
      spec,
      writes: [],
      killed: false,
      write(d) {
        this.writes.push(d);
      },
      kill() {
        this.killed = true;
      },
    };
    this.panes.push(pane);
    return pane;
  }
  byId(id: string): FakePane | undefined {
    return this.panes.find((p) => p.id === id);
  }
}

function fixture() {
  __resetPaneSeqForTests();
  const factory = new FakeFactory();
  const logs: string[] = [];
  const reg = new TmuxRegistry(factory, (m) => logs.push(m));
  return { factory, logs, reg };
}

// The real socket prefix Claude passes before every subcommand.
const S = ["-S", "/tmp/tmux-1000/default"];

test("parseTmuxArgs skips the global -S flag to find the subcommand", () => {
  const p = parseTmuxArgs([...S, "list-panes", "-t", "@0", "-F", "#{pane_id}"]);
  assert.equal(p.subcommand, "list-panes");
  assert.equal(p.opts["-t"], "@0");
  assert.equal(p.opts["-F"], "#{pane_id}");
});

test("parseTmuxArgs treats -l as a size value for split-window (no stray positional)", () => {
  const p = parseTmuxArgs([
    ...S,
    "split-window",
    "-t",
    "%0",
    "-h",
    "-l",
    "70%",
    "-P",
    "-F",
    "#{pane_id}",
  ]);
  assert.equal(p.subcommand, "split-window");
  assert.equal(p.opts["-l"], "70%"); // consumed as a value, not a command
  assert.deepEqual(p.command, []);
  assert.deepEqual(p.positionals, []);
});

test("parseTmuxArgs treats -l as boolean for send-keys; command is post-`--`", () => {
  const p = parseTmuxArgs([
    ...S,
    "send-keys",
    "-t",
    "%1",
    "-l",
    "--",
    "cd /x && run",
  ]);
  assert.equal(p.subcommand, "send-keys");
  assert.equal(p.opts["-l"], "");
  assert.deepEqual(p.command, ["cd /x && run"]);
});

test("parseTmuxArgs keeps bare positionals (the Enter key) separate", () => {
  const p = parseTmuxArgs([...S, "send-keys", "-t", "%1", "Enter"]);
  assert.deepEqual(p.positionals, ["Enter"]);
  assert.deepEqual(p.command, []);
});

// The captured teammate-create flow: split the leader → empty shell pane → type.
test("split-window off the leader opens a shell pane and returns its id", () => {
  const { factory, reg } = fixture();
  const res = reg.dispatch([
    ...S,
    "split-window",
    "-t",
    "%0",
    "-h",
    "-l",
    "70%",
    "-P",
    "-F",
    "#{pane_id}",
  ]);
  assert.equal(res.stdout, "%1"); // %0 is the leader; first teammate is %1
  assert.equal(factory.panes.length, 1);
  // No command ⇒ the factory will spawn a shell (command undefined here).
  assert.equal(factory.panes[0].spec.command, undefined);
});

test("list-panes -t @0 reports the leader plus spawned teammate panes", () => {
  const { reg } = fixture();
  assert.equal(
    reg.dispatch([...S, "list-panes", "-t", "@0", "-F", "#{pane_id}"]).stdout,
    "%0",
  );
  reg.dispatch([...S, "split-window", "-t", "%0", "-P", "-F", "#{pane_id}"]);
  reg.dispatch([
    ...S,
    "split-window",
    "-t",
    "%1",
    "-v",
    "-P",
    "-F",
    "#{pane_id}",
  ]);
  assert.equal(
    reg.dispatch([...S, "list-panes", "-t", "@0", "-F", "#{pane_id}"]).stdout,
    "%0\n%1\n%2",
  );
});

test("send-keys -l types the launch command into the pane; Enter sends a CR", () => {
  const { factory, reg } = fixture();
  reg.dispatch([...S, "split-window", "-t", "%0", "-P", "-F", "#{pane_id}"]);
  const launch =
    "cd /home/x && env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --agent-id a@duo";
  reg.dispatch([...S, "send-keys", "-t", "%1", "-l", "--", launch]);
  reg.dispatch([...S, "send-keys", "-t", "%1", "Enter"]);
  assert.deepEqual(factory.byId("%1")!.writes, [launch, "\r"]);
});

test("send-keys to the leader pane (%0) is a no-op (it's a phantom)", () => {
  const { factory, reg } = fixture();
  reg.dispatch([...S, "send-keys", "-t", "%0", "-l", "--", "nope"]);
  assert.equal(factory.panes.length, 0);
});

test("display-message resolves the leader's own pane/window context", () => {
  const { reg } = fixture();
  assert.equal(
    reg.dispatch([...S, "display-message", "-t", "%0", "-p", "#{window_id}"])
      .stdout,
    "@0",
  );
  assert.equal(
    reg.dispatch([...S, "display-message", "-p", "#{pane_id}"]).stdout,
    "%0",
  );
  assert.equal(
    reg.dispatch([...S, "display-message", "-p", "#{client_control_mode}"])
      .stdout,
    "",
  );
});

test("has-session: leader 'default' exists; unknown sessions don't", () => {
  const { reg } = fixture();
  assert.equal(
    reg.dispatch([...S, "has-session", "-t", "default"]).exitCode,
    0,
  );
  assert.equal(reg.dispatch([...S, "has-session", "-t", "ghost"]).exitCode, 1);
});

test("tmux -V passes the availability gate", () => {
  const { reg } = fixture();
  const res = reg.dispatch(["-V"]);
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /tmux \d/);
});

test("config probes answer plausibly (mouse/focus off, prefix C-b)", () => {
  const { reg } = fixture();
  assert.equal(
    reg.dispatch([...S, "show", "-gv", "focus-events"]).stdout.trim(),
    "off",
  );
  assert.equal(
    reg.dispatch([...S, "show", "-Av", "mouse"]).stdout.trim(),
    "off",
  );
  assert.match(
    reg.dispatch([...S, "show-options", "-g", "prefix"]).stdout,
    /prefix\s+C-b/,
  );
});

test("styling/layout/attach commands are recognised no-ops (not drift)", () => {
  const { logs, reg } = fixture();
  for (const c of [
    ["select-pane", "-t", "%1", "-T", "agent-1"],
    ["set-option", "-p", "-t", "%1", "pane-border-style", "fg=blue"],
    ["select-layout", "-t", "@0", "main-vertical"],
    ["resize-pane", "-t", "%0", "-x", "30%"],
    ["switch-client", "-t", "default"],
    ["attach-session", "-t", "default"],
    ["load-buffer", "-"],
  ]) {
    assert.equal(reg.dispatch([...S, ...c]).exitCode, 0);
  }
  assert.equal(logs.length, 0, "all recognised — none logged as drift");
});

test("an unrecognised subcommand is logged and no-op'd", () => {
  const { logs, reg } = fixture();
  const res = reg.dispatch([...S, "capture-pane", "-t", "%0", "-p"]);
  assert.equal(res.exitCode, 0);
  assert.match(logs[0], /unrecognised tmux subcommand/);
});

test("kill-pane disposes the specific teammate pane (ends an agent)", () => {
  const { factory, reg } = fixture();
  reg.dispatch([...S, "split-window", "-t", "%0", "-P", "-F", "#{pane_id}"]); // %1
  reg.dispatch([...S, "split-window", "-t", "%1", "-P", "-F", "#{pane_id}"]); // %2
  reg.dispatch([...S, "kill-pane", "-t", "%1"]);
  assert.equal(factory.byId("%1")!.killed, true);
  assert.equal(factory.byId("%2")!.killed, false);
  // %1 gone from the window; %0 (leader) + %2 remain.
  assert.equal(
    reg.dispatch([...S, "list-panes", "-t", "@0", "-F", "#{pane_id}"]).stdout,
    "%0\n%2",
  );
});

test("kill-session disposes a team session's panes (never the leader)", () => {
  const { factory, reg } = fixture();
  reg.dispatch([
    ...S,
    "new-session",
    "-s",
    "duo",
    "-P",
    "-F",
    "#{pane_id}",
    "--",
    "a",
  ]);
  reg.dispatch([...S, "kill-session", "-t", "duo"]);
  assert.ok(factory.panes.every((p) => p.killed));
  assert.equal(reg.dispatch([...S, "has-session", "-t", "duo"]).exitCode, 1);
  // Leader survives.
  assert.equal(
    reg.dispatch([...S, "has-session", "-t", "default"]).exitCode,
    0,
  );
});

test("renderFormat resolves known tokens and empties unknown ones", () => {
  assert.equal(renderFormat("#{pane_id}", { pane_id: "%7" }), "%7");
  assert.equal(renderFormat("pre-#{nope}-post", {}), "pre--post");
});
