/**
 * Conformance drift-guard for the agent-teams `tmux` shim (SP-tgnb5o_SL-4, AC#6).
 *
 * Replays the documented agent-teams invocation sequence (tmuxSurface.ts)
 * through the real dispatcher and asserts **zero unrecognised invocations** —
 * i.e. every `tmux` command the surface contains is handled, not log-and-no-op'd
 * — plus the expected pane lifecycle (two teammates formed, control-mode empty,
 * session torn down). If a future change to our shim stops handling part of the
 * surface, or the fixture is updated to a new live-captured surface that we
 * don't yet support, this turns into a red build instead of a silent gap.
 *
 * Scope note: the fixture is the *documented* surface, not a live capture (see
 * tmuxSurface.ts). "Both teammates reach idle" against a real Claude Code run is
 * the recorded acceptance-gate check, not asserted here.
 *
 * Run via `npm test`.
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

test("documented agent-teams tmux surface replays with zero unrecognised invocations", () => {
  const factory = new CountingFactory();
  const unrecognised: string[] = [];
  const reg = new TmuxRegistry(factory, (m) => {
    if (m.startsWith("unrecognised")) unrecognised.push(m);
  });

  let controlMode: string | null = null;
  for (const argv of AGENT_TEAMS_TMUX_FIXTURE) {
    const res = reg.dispatch(argv);
    if (argv[0] === "display-message") controlMode = res.stdout;
    // Every invocation must succeed (exit 0) except has-session, which is a
    // truthy/falsy probe — and "team" is live by then, so it's also 0.
    assert.equal(res.exitCode, 0, `non-zero exit for: ${argv.join(" ")}`);
  }

  // The whole documented surface is recognised — nothing fell through.
  assert.deepEqual(
    unrecognised,
    [],
    `unrecognised invocations: ${unrecognised.join("; ")}`,
  );
  // Two teammates were spawned, control-mode probe came back empty (AC#3),
  // and kill-session disposed the team (AC#2 lifecycle).
  assert.equal(factory.spawned, 2);
  assert.equal(controlMode, "");
  assert.equal(reg.paneCount(), 0, "kill-session should leave no live panes");
});

test("a hypothetical new subcommand would be flagged (the guard actually guards)", () => {
  const unrecognised: string[] = [];
  const reg = new TmuxRegistry(new CountingFactory(), (m) => {
    if (m.startsWith("unrecognised")) unrecognised.push(m);
  });
  reg.dispatch(["capture-pane", "-t", "%0", "-p"]); // not in our subset
  assert.equal(unrecognised.length, 1);
});
