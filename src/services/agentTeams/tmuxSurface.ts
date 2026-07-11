/**
 * The agent-teams `tmux` command surface.
 *
 * CAPTURED from a real tmux session driving Claude Code 2.1.177 agent teams
 * (logging-wrapper capture, 2026-06-15) — this is the actual choreography, not
 * a guess. Replayed by the conformance drift-guard (SL-4) and described in the
 * internals doc (SL-5). Note the global `-S <socket>` before each subcommand and
 * the empty-pane-then-`send-keys` teammate launch.
 *
 * Re-verify with the §7 capture recipe after Claude Code updates and update this.
 */

/** One `tmux` invocation as argv (without the leading "tmux"). */
export type TmuxInvocation = string[];

// Claude passes the server socket (from $TMUX) before every session-scoped call.
const G = ["-S", "/tmp/tmux-1000/default"];
const LAUNCH1 =
  "cd /home/x && env CLAUDECODE=1 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --agent-id agent-1@duo --agent-name agent-1 --team-name duo";
const LAUNCH2 =
  "cd /home/x && env CLAUDECODE=1 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --agent-id agent-2@duo --agent-name agent-2 --team-name duo";

/** The real 2-teammate sequence: probes → split leader → style → type launch. */
export const AGENT_TEAMS_TMUX_FIXTURE: TmuxInvocation[] = [
  // Config-detection probes (no socket yet).
  ["show", "-gv", "focus-events"],
  ["display-message", "-p", "#{client_termtype}"],
  // Locate the leader's window + count panes.
  [...G, "display-message", "-t", "%0", "-p", "#{window_id}"],
  [...G, "list-panes", "-t", "@0", "-F", "#{pane_id}"],
  // Teammate 1: split the leader pane into an empty pane, style it, then type.
  [
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
  ],
  [...G, "select-pane", "-t", "%1", "-P", "bg=default,fg=blue"],
  [...G, "set-option", "-p", "-t", "%1", "pane-border-style", "fg=blue"],
  [...G, "select-pane", "-t", "%1", "-T", "agent-1"],
  [...G, "list-panes", "-t", "@0", "-F", "#{pane_id}"],
  [...G, "set-option", "-w", "-t", "@0", "pane-border-status", "top"],
  [...G, "send-keys", "-t", "%1", "-l", "--", LAUNCH1],
  [...G, "send-keys", "-t", "%1", "Enter"],
  // Teammate 2: split again, style, lay out, type.
  [...G, "split-window", "-t", "%1", "-v", "-P", "-F", "#{pane_id}"],
  [...G, "select-pane", "-t", "%2", "-P", "bg=default,fg=green"],
  [...G, "select-pane", "-t", "%2", "-T", "agent-2"],
  [...G, "select-layout", "-t", "@0", "main-vertical"],
  [...G, "resize-pane", "-t", "%0", "-x", "30%"],
  [...G, "send-keys", "-t", "%2", "-l", "--", LAUNCH2],
  [...G, "send-keys", "-t", "%2", "Enter"],
];
