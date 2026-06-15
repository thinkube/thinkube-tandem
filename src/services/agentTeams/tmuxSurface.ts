/**
 * The documented agent-teams `tmux` command surface (SP-tgnb5o, AC#6/AC#7).
 *
 * A representative sequence of the `tmux` invocations Claude Code's experimental
 * agent teams make when forming and driving a 2-teammate team. This is the
 * single source the conformance drift-guard (SL-4) replays and the internals
 * doc (SL-5) describes.
 *
 * IMPORTANT — provenance: this fixture is derived from the **documented**
 * surface (the Spec + TEP-tgnb5h + docs/claude-code-internals.md), NOT yet from
 * a live capture against Claude Code. So the conformance test below guards
 * against regressions in *our* shim and pins the surface we claim to support;
 * it does NOT by itself prove parity with a live Claude Code release. Live
 * parity ("a real team forms and both teammates reach idle") is the recorded
 * acceptance-gate check (TEP-tgnvkw exception on this Spec). When the surface is
 * captured live (the §7 re-verify playbook), update this fixture to match.
 */

/** One `tmux` invocation as argv (without the leading "tmux"). */
export type TmuxInvocation = string[];

/**
 * Representative invocations for a 2-teammate team: probe control-mode, open
 * the session + a second pane, drive each teammate, enumerate, then tear down.
 * `%0`/`%1` are the pane ids our shim mints in order.
 */
export const AGENT_TEAMS_TMUX_FIXTURE: TmuxInvocation[] = [
  // Claude probes whether it's an iTerm2 control-mode client (must be empty).
  ["display-message", "-p", "#{client_control_mode}"],
  // First teammate: a detached session, pane id read back via -P -F.
  [
    "new-session",
    "-d",
    "-s",
    "team",
    "-P",
    "-F",
    "#{pane_id}",
    "--",
    "node",
    "teammate.js",
    "0",
  ],
  // Second teammate: split the session window.
  [
    "split-window",
    "-t",
    "team",
    "-P",
    "-F",
    "#{pane_id}",
    "--",
    "node",
    "teammate.js",
    "1",
  ],
  // Drive teammate 0: literal text then Enter.
  ["send-keys", "-t", "team:0.%0", "-l", "--", "do the thing"],
  ["send-keys", "-t", "team:0.%0", "Enter"],
  // Drive teammate 1.
  ["send-keys", "-t", "team:0.%1", "-l", "--", "and the other thing"],
  ["send-keys", "-t", "team:0.%1", "Enter"],
  // Housekeeping Claude does between turns.
  ["has-session", "-t", "team"],
  ["list-panes", "-t", "team", "-F", "#{pane_id}"],
  ["select-pane", "-t", "team:0.%1"],
  // Tear the team down.
  ["kill-session", "-t", "team"],
];
