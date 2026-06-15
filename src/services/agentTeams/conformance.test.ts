/**
 * Conformance drift-guard for the agent-teams `tmux` shim (SP-tgnb5o_SL-4, AC#6).
 *
 * Replays the CAPTURED agent-teams choreography (tmuxSurface.ts) through the
 * real dispatcher and asserts **zero unrecognised invocations** (every command
 * the live surface uses is handled) plus the expected pane outcome: two teammate
 * shell panes spawned off the leader, all reachable via `list-panes -t @0`. If a
 * future Claude Code release changes the surface, re-capturing (the §7 recipe)
 * into tmuxSurface.ts turns any newly-unhandled command into a red build.
 *
 * "Both teammates reach idle" against a real run is the acceptance-gate check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { TmuxRegistry, type Pane, type PaneFactory } from "./tmuxDispatcher";
import { AGENT_TEAMS_TMUX_FIXTURE } from "./tmuxSurface";

class CountingFactory implements PaneFactory {
  spawned = 0;
  spawn(spec: { paneId: string }): Pane {
    this.spawned++;
    return { id: spec.paneId, write() {}, kill() {} };
  }
}

test("captured agent-teams surface replays with zero unrecognised invocations", () => {
  const factory = new CountingFactory();
  const unrecognised: string[] = [];
  const reg = new TmuxRegistry(factory, (m) => {
    if (m.startsWith("unrecognised")) unrecognised.push(m);
  });

  for (const argv of AGENT_TEAMS_TMUX_FIXTURE) {
    const res = reg.dispatch(argv);
    assert.equal(res.exitCode, 0, `non-zero exit for: ${argv.join(" ")}`);
  }

  assert.deepEqual(
    unrecognised,
    [],
    `unrecognised invocations: ${unrecognised.join("; ")}`,
  );
  // Two teammate panes were opened off the leader…
  assert.equal(factory.spawned, 2);
  // …and the window now lists the leader plus both teammates.
  assert.equal(
    reg.dispatch(["-S", "x", "list-panes", "-t", "@0", "-F", "#{pane_id}"])
      .stdout,
    "%0\n%1\n%2",
  );
});

test("a new/unhandled subcommand is flagged (the guard actually guards)", () => {
  const unrecognised: string[] = [];
  const reg = new TmuxRegistry(new CountingFactory(), (m) => {
    if (m.startsWith("unrecognised")) unrecognised.push(m);
  });
  reg.dispatch(["-S", "x", "capture-pane", "-t", "%0", "-p"]); // not in our subset
  assert.equal(unrecognised.length, 1);
});
