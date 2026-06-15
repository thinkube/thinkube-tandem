/**
 * Unit tests for the pure agent-teams `tmux` dispatcher (SP-tgnb5o_SL-1).
 * Run via `npm test`. No vscode/node-pty — a fake PaneFactory records spawns
 * and writes, so the reverse-engineered command surface (AC#2), the
 * `client_control_mode` probe (AC#3), and the log-and-no-op contract are all
 * verifiable headlessly.
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
      write(data: string) {
        this.writes.push(data);
      },
      kill() {
        this.killed = true;
      },
    };
    this.panes.push(pane);
    return pane;
  }
}

function fixture() {
  __resetPaneSeqForTests();
  const factory = new FakeFactory();
  const logs: string[] = [];
  const reg = new TmuxRegistry(factory, (m) => logs.push(m));
  return { factory, logs, reg };
}

test("parseTmuxArgs splits subcommand, value flags, booleans, and post-`--`", () => {
  const p = parseTmuxArgs([
    "new-session",
    "-d",
    "-s",
    "team1",
    "-P",
    "-F",
    "#{pane_id}",
    "--",
    "/usr/bin/node",
    "teammate.js",
    "--role=builder",
  ]);
  assert.equal(p.subcommand, "new-session");
  assert.equal(p.opts["-s"], "team1");
  assert.equal(p.opts["-F"], "#{pane_id}");
  assert.equal(p.opts["-d"], ""); // boolean flag
  assert.equal(p.opts["-P"], "");
  assert.deepEqual(p.rest, ["/usr/bin/node", "teammate.js", "--role=builder"]);
});

// AC#2: the subset is implemented and returns `#{pane_id}` handles.
test("new-session spawns a teammate and returns the minted pane id via -F", () => {
  const { factory, reg } = fixture();
  const res = reg.dispatch([
    "new-session",
    "-d",
    "-s",
    "team1",
    "-P",
    "-F",
    "#{pane_id}",
    "--",
    "node",
    "teammate.js",
  ]);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "%0"); // first minted id, format-rendered
  assert.equal(factory.panes.length, 1);
  assert.deepEqual(factory.panes[0].spec.command, "node");
  assert.deepEqual(factory.panes[0].spec.args, ["teammate.js"]);
  assert.equal(factory.panes[0].spec.sessionName, "team1");
});

test("split-window adds a second pane to the session", () => {
  const { factory, reg } = fixture();
  reg.dispatch(["new-session", "-s", "t", "-P", "-F", "#{pane_id}", "--", "a"]);
  const res = reg.dispatch([
    "split-window",
    "-t",
    "t",
    "-P",
    "-F",
    "#{pane_id}",
    "--",
    "b",
  ]);
  assert.equal(res.stdout, "%1");
  assert.equal(factory.panes.length, 2);
  assert.equal(reg.paneCount(), 2);
});

// AC#2: send-keys literal + Enter route to the right pane's PTY.
test("send-keys -l writes literal text and Enter writes a carriage return", () => {
  const { factory, reg } = fixture();
  reg.dispatch(["new-session", "-s", "t", "-P", "-F", "#{pane_id}", "--", "a"]);
  reg.dispatch(["send-keys", "-t", "t:0.%0", "-l", "--", "hello world"]);
  reg.dispatch(["send-keys", "-t", "%0", "Enter"]);
  assert.deepEqual(factory.panes[0].writes, ["hello world", "\r"]);
});

test("has-session reflects live sessions (exit 0 / 1)", () => {
  const { reg } = fixture();
  reg.dispatch(["new-session", "-s", "live", "-F", "#{pane_id}", "--", "a"]);
  assert.equal(reg.dispatch(["has-session", "-t", "live"]).exitCode, 0);
  assert.equal(reg.dispatch(["has-session", "-t", "ghost"]).exitCode, 1);
});

test("list-panes enumerates pane ids for a session", () => {
  const { reg } = fixture();
  reg.dispatch(["new-session", "-s", "t", "-F", "#{pane_id}", "--", "a"]);
  reg.dispatch(["split-window", "-t", "t", "-F", "#{pane_id}", "--", "b"]);
  const res = reg.dispatch(["list-panes", "-t", "t", "-F", "#{pane_id}"]);
  assert.deepEqual(res.stdout.split("\n").sort(), ["%0", "%1"]);
});

test("kill-session disposes every pane in the session", () => {
  const { factory, reg } = fixture();
  reg.dispatch(["new-session", "-s", "t", "-F", "#{pane_id}", "--", "a"]);
  reg.dispatch(["split-window", "-t", "t", "-F", "#{pane_id}", "--", "b"]);
  reg.dispatch(["kill-session", "-t", "t"]);
  assert.ok(factory.panes.every((p) => p.killed));
  assert.equal(reg.paneCount(), 0);
  assert.equal(reg.dispatch(["has-session", "-t", "t"]).exitCode, 1);
});

// AC#3: the iTerm2 control-mode probe must come back empty.
test("display-message #{client_control_mode} returns empty (stays off the -CC path)", () => {
  const { reg } = fixture();
  const res = reg.dispatch(["display-message", "-p", "#{client_control_mode}"]);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "");
});

test("display-message with -F also resolves client_control_mode to empty", () => {
  const { reg } = fixture();
  const res = reg.dispatch([
    "display-message",
    "-p",
    "-F",
    "#{client_control_mode}",
  ]);
  assert.equal(res.stdout, "");
});

// Constraint: unrecognised invocations are logged and no-op'd (never crash).
test("unrecognised subcommand is logged and returns exit 0", () => {
  const { logs, reg } = fixture();
  const res = reg.dispatch(["capture-pane", "-t", "%0", "-p"]);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /unrecognised tmux subcommand/);
});

test("cosmetic subcommands are silent no-ops", () => {
  const { logs, reg } = fixture();
  for (const sub of ["select-pane", "set-option", "resize-pane"]) {
    assert.equal(reg.dispatch([sub, "-t", "%0"]).exitCode, 0);
  }
  assert.equal(logs.length, 0);
});

// Claude resolves its own current pane/window via display-message; empty here
// caused "Could not determine current tmux pane/window" live (spike).
test("display-message resolves a current pane/window context", () => {
  const { reg } = fixture();
  assert.equal(
    reg.dispatch(["display-message", "-p", "#{pane_id}"]).stdout,
    "%0",
  );
  assert.equal(
    reg.dispatch([
      "display-message",
      "-p",
      "#{session_name}:#{window_index}.#{pane_index}",
    ]).stdout,
    "default:0.0",
  );
});

// Init-probe surface the pane backend runs before committing to tmux (spike).
test("tmux -V reports a version so the availability gate passes", () => {
  const { reg } = fixture();
  const res = reg.dispatch(["-V"]);
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /tmux \d/);
});

test("show -gv focus-events / -Av mouse answer a non-'on' value", () => {
  const { reg } = fixture();
  assert.equal(
    reg.dispatch(["show", "-gv", "focus-events"]).stdout.trim(),
    "off",
  );
  // -Av includes -v (value-only), so just the value comes back.
  assert.equal(reg.dispatch(["show", "-Av", "mouse"]).stdout.trim(), "off");
});

test("show-options -g prefix returns the tmux default C-b", () => {
  const { reg } = fixture();
  assert.match(
    reg.dispatch(["show-options", "-g", "prefix"]).stdout,
    /prefix\s+C-b/,
  );
});

test("switch-client / attach-session / load-buffer are recognised no-ops", () => {
  const { logs, reg } = fixture();
  for (const c of [
    ["switch-client", "-t", "team"],
    ["attach-session", "-t", "team"],
    ["load-buffer", "-"],
  ]) {
    assert.equal(reg.dispatch(c).exitCode, 0);
  }
  assert.equal(logs.length, 0, "should be recognised, not logged as drift");
});

test("renderFormat resolves known tokens and empties unknown ones", () => {
  assert.equal(renderFormat("#{pane_id}", { pane_id: "%7" }), "%7");
  assert.equal(renderFormat("pre-#{nope}-post", {}), "pre--post");
});
