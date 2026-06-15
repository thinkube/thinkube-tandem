/**
 * Pure dispatcher for the agent-teams `tmux` shim (SP-tgnb5o).
 *
 * Claude Code's experimental agent-teams feature (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)
 * drives a display backend by shelling out to `tmux`. Where neither tmux nor
 * iTerm2 is available (plain VS Code), we put a fake `tmux` on PATH that forwards
 * each invocation to this dispatcher, which maps the subset Claude actually calls
 * onto a pane registry (PTYs rendered as native VS Code terminals — supplied by
 * the host as a `PaneFactory`).
 *
 * The command surface and choreography here were CAPTURED from a real tmux
 * session driving Claude Code 2.1.177 agent teams (logging-wrapper capture,
 * SP-tgnb5o). The real flow, per teammate:
 *
 *   tmux -S <sock> display-message -t %0 -p '#{window_id}'      → leader window
 *   tmux -S <sock> list-panes -t @0 -F '#{pane_id}'             → pane count
 *   tmux -S <sock> split-window -t %0 -h -l 70% -P -F '#{pane_id}'   → EMPTY pane
 *   tmux -S <sock> select-pane/set-option/select-layout/resize-pane … → styling (no-ops)
 *   tmux -S <sock> send-keys -t %1 -l -- 'cd … && env … <claude> --agent-id …'
 *   tmux -S <sock> send-keys -t %1 Enter                        → run it
 *
 * So a teammate pane is an EMPTY shell pane that Claude then *types* the launch
 * command into. The leader (`%0`, window `@0`) is the Claude process itself — a
 * phantom we report but never spawn. Note the global `-S <socket>` flag precedes
 * the subcommand. This module has no `vscode`/`node-pty` imports so it's
 * unit-testable; the real PTY/pane plumbing is injected.
 *
 * Anything unrecognised is logged and no-op'd (exit 0), never crashed.
 */

/** A live pane: a PTY whose bytes render in a VS Code terminal. */
export interface Pane {
  readonly id: string; // tmux `#{pane_id}`, e.g. "%1"
  write(data: string): void;
  kill(): void;
}

/**
 * What the factory needs to open a pane. `command` is optional: agent-teams
 * creates an EMPTY pane (a shell) and launches the teammate later via send-keys,
 * so when `command` is undefined the factory spawns the user's default shell.
 */
export interface TeammateSpec {
  sessionName: string;
  paneId: string;
  command?: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

/** Host-supplied PTY+pane creation. Real impl uses node-pty + a VS Code
 *  Pseudoterminal; tests pass a fake. */
export interface PaneFactory {
  spawn(spec: TeammateSpec): Pane;
}

export interface DispatchResult {
  stdout: string;
  exitCode: number;
}

/** Parsed shape of a `tmux [-S sock …] <subcommand> …flags [positionals] [-- cmd]`. */
export interface ParsedTmux {
  subcommand: string;
  /** option → value (last wins); valueless flags map to "". */
  opts: Record<string, string>;
  /** the explicit teammate command after `--` (empty ⇒ open a shell pane). */
  command: string[];
  /** bare positional args before `--` (e.g. the `Enter` key for send-keys). */
  positionals: string[];
}

// tmux GLOBAL options that precede the subcommand (`tmux -S <sock> new-session`).
const GLOBAL_VALUE_FLAGS = new Set(["-S", "-L", "-f", "-c", "-T"]);
const GLOBAL_BOOL_FLAGS = new Set([
  "-2",
  "-8",
  "-u",
  "-N",
  "-q",
  "-C",
  "-D",
  "-l",
]);
// Subcommand flags that take a value (everything else is boolean).
const VALUE_FLAGS = new Set(["-t", "-s", "-F", "-c", "-x", "-y", "-n", "-l"]);

/**
 * Parse a `tmux` argv (without the leading "tmux"). Skips the global options
 * before the subcommand, separates the explicit post-`--` command from bare
 * positionals, and tolerates unknown flags (kept as boolean opts) so an upstream
 * addition degrades to log-and-no-op rather than a crash.
 *
 * `-l` is a value flag for `split-window` (size, e.g. `-l 70%`) but a boolean
 * for `send-keys` (literal). We treat it as a value flag generally; `send-keys`
 * is special-cased by the registry (it reads `-l` via the opts key).
 */
export function parseTmuxArgs(argv: string[]): ParsedTmux {
  let i = 0;
  // Skip global options (e.g. `-S <socket>`) that precede the subcommand.
  while (i < argv.length) {
    const tok = argv[i];
    if (GLOBAL_VALUE_FLAGS.has(tok)) {
      i += 2;
      continue;
    }
    if (GLOBAL_BOOL_FLAGS.has(tok)) {
      i += 1;
      continue;
    }
    break;
  }
  const subcommand = argv[i] ?? "";
  i += 1;

  // `send-keys` uses `-l` as a boolean (literal mode), not a size value.
  const valueFlags =
    subcommand === "send-keys"
      ? new Set([...VALUE_FLAGS].filter((f) => f !== "-l"))
      : VALUE_FLAGS;

  const opts: Record<string, string> = {};
  const command: string[] = [];
  const positionals: string[] = [];
  for (; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") {
      command.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith("-") && tok !== "-") {
      if (valueFlags.has(tok)) {
        opts[tok] = argv[++i] ?? "";
      } else {
        opts[tok] = "";
      }
    } else {
      positionals.push(tok);
    }
  }
  return { subcommand, opts, command, positionals };
}

// The leader — the Claude process itself: pane %0, window @0, session "default".
// We never spawn it (it's a phantom) but report it so list-panes/count work and
// `split-window -t %0` resolves.
const LEADER_PANE = "%0";
const LEADER_WINDOW = "@0";
const LEADER_SESSION = "default";

let paneSeq = 1; // teammate panes mint %1, %2, … (%0 is the leader)
let windowSeq = 1; // new windows mint @1, @2, … (@0 is the leader window)
function nextPaneId(): string {
  return `%${paneSeq++}`;
}
function nextWindowId(): string {
  return `@${windowSeq++}`;
}

/** For tests: reset the id counters so ids are deterministic. */
export function __resetPaneSeqForTests(): void {
  paneSeq = 1;
  windowSeq = 1;
}

interface PaneEntry {
  pane: Pane | null; // null ⇒ phantom leader (no PTY/terminal)
  windowId: string;
  sessionName: string;
}

/**
 * The registry + command handler. One instance per Extension Host; the IPC
 * server feeds it parsed invocations and returns {stdout, exitCode}.
 */
export class TmuxRegistry {
  // Insertion-ordered: the leader is seeded first so it lists/counts first.
  private readonly panes = new Map<string, PaneEntry>();
  // sessionName → set of its window ids.
  private readonly sessions = new Map<string, Set<string>>();

  constructor(
    private readonly factory: PaneFactory,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.panes.set(LEADER_PANE, {
      pane: null,
      windowId: LEADER_WINDOW,
      sessionName: LEADER_SESSION,
    });
    this.sessions.set(LEADER_SESSION, new Set([LEADER_WINDOW]));
  }

  dispatch(argv: string[]): DispatchResult {
    const p = parseTmuxArgs(argv);
    switch (p.subcommand) {
      case "new-session":
      case "new":
        return this.newSession(p);
      case "split-window":
        return this.splitWindow(p);
      case "new-window":
        return this.newWindow(p);
      case "send-keys":
        return this.sendKeys(p);
      case "kill-session":
        return this.killSession(p);
      case "kill-pane":
        return this.killPane(p);
      case "kill-window":
        return this.killWindow(p);
      case "has-session":
        return this.hasSession(p);
      case "list-panes":
        return this.listPanes(p);
      case "display-message":
        return this.displayMessage(p);
      // Availability gate + config probes (must answer plausibly or Claude
      // falls back to the in-process backend).
      case "-V":
        return { stdout: "tmux 3.4\n", exitCode: 0 };
      case "show":
        return this.showOption(p);
      case "show-options":
        return this.showOptionsCmd(p);
      // Focus / attach / clipboard / styling / layout — VS Code owns the layout,
      // so accept these as successful no-ops.
      case "switch-client":
      case "attach-session":
      case "load-buffer":
      case "select-pane":
      case "set-option":
      case "set-hook":
      case "resize-pane":
      case "select-layout":
      case "rename-window":
        return ok();
      // A bare `tmux` (no subcommand) — starting/attaching; nothing for us to do.
      case "":
        return ok();
      default:
        this.log(`unrecognised tmux subcommand: ${argv.join(" ")}`);
        return ok();
    }
  }

  // ---- pane creation ------------------------------------------------------

  private newSession(p: ParsedTmux): DispatchResult {
    const sessionName =
      p.opts["-s"] ?? p.opts["-t"]?.split(":")[0] ?? "default";
    const windowId = nextWindowId();
    this.registerWindow(sessionName, windowId);
    return this.openPane(p, windowId, sessionName);
  }

  private splitWindow(p: ParsedTmux): DispatchResult {
    const windowId = this.windowForTarget(p.opts["-t"]);
    const sessionName = this.sessionForWindow(windowId);
    return this.openPane(p, windowId, sessionName);
  }

  private newWindow(p: ParsedTmux): DispatchResult {
    const sessionName = this.sessionForTarget(p.opts["-t"]);
    const windowId = nextWindowId();
    this.registerWindow(sessionName, windowId);
    return this.openPane(p, windowId, sessionName);
  }

  private openPane(
    p: ParsedTmux,
    windowId: string,
    sessionName: string,
  ): DispatchResult {
    const paneId = nextPaneId();
    const [command, ...args] = p.command; // empty ⇒ factory spawns a shell
    const pane = this.factory.spawn({
      sessionName,
      paneId,
      command,
      args,
      cwd: p.opts["-c"],
    });
    this.panes.set(paneId, { pane, windowId, sessionName });
    const fmt = p.opts["-F"];
    const stdout = fmt
      ? renderFormat(fmt, { pane_id: paneId, window_id: windowId })
      : paneId;
    return { stdout, exitCode: 0 };
  }

  // ---- input --------------------------------------------------------------

  private sendKeys(p: ParsedTmux): DispatchResult {
    const entry = this.entryByTarget(p.opts["-t"]);
    if (!entry || !entry.pane) {
      // Leader (%0, phantom) or unknown pane — Claude only types into teammate
      // panes, so this is just diagnostic.
      this.log(`send-keys to non-pane target: ${p.opts["-t"] ?? "(none)"}`);
      return ok();
    }
    if ("-l" in p.opts) {
      // Literal bytes: the text is the post-`--` command (or bare positionals).
      const text = p.command.length
        ? p.command.join(" ")
        : p.positionals.join(" ");
      entry.pane.write(text);
    } else {
      for (const key of p.positionals) {
        if (key === "Enter" || key === "C-m") entry.pane.write("\r");
        else this.log(`send-keys unmapped key-name: ${key}`);
      }
    }
    return ok();
  }

  // ---- queries / lifecycle ------------------------------------------------

  private killSession(p: ParsedTmux): DispatchResult {
    const name = p.opts["-t"]?.split(":")[0] ?? LEADER_SESSION;
    if (name === LEADER_SESSION) return ok(); // never tear down the leader
    for (const [id, e] of [...this.panes]) {
      if (e.sessionName === name) {
        e.pane?.kill();
        this.panes.delete(id);
      }
    }
    this.sessions.delete(name);
    return ok();
  }

  private killPane(p: ParsedTmux): DispatchResult {
    // Claude ends a single teammate with `kill-pane -t %N` — dispose that pane's
    // PTY + VS Code terminal so it doesn't linger as an empty shell prompt.
    const id = this.normPane(p.opts["-t"] ?? "");
    const entry = this.panes.get(id);
    if (entry?.pane) {
      entry.pane.kill();
      this.panes.delete(id);
    }
    return ok();
  }

  private killWindow(p: ParsedTmux): DispatchResult {
    const win = this.windowForTarget(p.opts["-t"]);
    for (const [id, e] of [...this.panes]) {
      if (e.windowId === win && e.pane) {
        e.pane.kill();
        this.panes.delete(id);
      }
    }
    return ok();
  }

  private hasSession(p: ParsedTmux): DispatchResult {
    const name = p.opts["-t"]?.split(":")[0] ?? "";
    return { stdout: "", exitCode: this.sessions.has(name) ? 0 : 1 };
  }

  private listPanes(p: ParsedTmux): DispatchResult {
    const windowId = this.windowForTarget(p.opts["-t"]);
    const ids = [...this.panes.entries()]
      .filter(([, e]) => e.windowId === windowId)
      .map(([id]) => id);
    const fmt = p.opts["-F"];
    const lines = ids.map((id) =>
      fmt ? renderFormat(fmt, { pane_id: id }) : id,
    );
    return { stdout: lines.join("\n"), exitCode: 0 };
  }

  private displayMessage(p: ParsedTmux): DispatchResult {
    // The requested format is the positional after `-p` (or via `-F`). Claude
    // uses it to stay off the iTerm2 `-CC` path (`#{client_control_mode}` must
    // be EMPTY) and to locate its own current pane/window. We run "inside tmux"
    // per the synthetic $TMUX, so answer a stable fabricated current context.
    const fmt = p.opts["-F"] ?? p.positionals[p.positionals.length - 1] ?? "";
    const stdout = renderFormat(fmt, {
      client_control_mode: "",
      client_termtype: "tmux-256color",
      pane_id: LEADER_PANE,
      pane_index: "0",
      window_id: LEADER_WINDOW,
      window_index: "0",
      window_name: "claude",
      session_name: LEADER_SESSION,
      session_id: "$0",
    });
    return { stdout, exitCode: 0 };
  }

  private showOption(p: ParsedTmux): DispatchResult {
    const name = p.positionals[0] ?? "";
    const valueOnly = Object.keys(p.opts).some((k) => k.includes("v"));
    const value = "off";
    return {
      stdout: valueOnly ? `${value}\n` : `${name} ${value}\n`,
      exitCode: 0,
    };
  }

  private showOptionsCmd(p: ParsedTmux): DispatchResult {
    const name = p.positionals[p.positionals.length - 1] ?? "";
    if (name === "prefix") return { stdout: "prefix C-b\n", exitCode: 0 };
    return { stdout: name ? `${name}\n` : "", exitCode: 0 };
  }

  // ---- target resolution --------------------------------------------------

  private registerWindow(sessionName: string, windowId: string): void {
    let wins = this.sessions.get(sessionName);
    if (!wins) {
      wins = new Set();
      this.sessions.set(sessionName, wins);
    }
    wins.add(windowId);
  }

  private normPane(t: string): string {
    return t.includes("%") ? "%" + t.split("%")[1] : t;
  }

  private windowForTarget(t: string | undefined): string {
    if (!t) return LEADER_WINDOW;
    if (t.startsWith("@")) return t.split(".")[0];
    if (t.startsWith("%")) {
      return this.panes.get(this.normPane(t))?.windowId ?? LEADER_WINDOW;
    }
    const wins = this.sessions.get(t.split(":")[0]);
    return wins && wins.size ? [...wins][0] : LEADER_WINDOW;
  }

  private sessionForWindow(windowId: string): string {
    for (const [s, wins] of this.sessions) if (wins.has(windowId)) return s;
    return LEADER_SESSION;
  }

  private sessionForTarget(t: string | undefined): string {
    if (!t) return LEADER_SESSION;
    if (t.startsWith("%")) {
      return this.panes.get(this.normPane(t))?.sessionName ?? LEADER_SESSION;
    }
    if (t.startsWith("@")) return this.sessionForWindow(t.split(".")[0]);
    return t.split(":")[0];
  }

  private entryByTarget(t: string | undefined): PaneEntry | undefined {
    if (!t) return undefined;
    return this.panes.get(this.normPane(t));
  }

  /** Test/diagnostic: count of real (non-phantom) panes. */
  paneCount(): number {
    let n = 0;
    for (const e of this.panes.values()) if (e.pane) n++;
    return n;
  }
}

function ok(): DispatchResult {
  return { stdout: "", exitCode: 0 };
}

/**
 * Resolve the `#{token}` placeholders tmux's `-F` format uses, against a small
 * known map. Unknown tokens resolve to empty (matching tmux for an undefined
 * format variable), which is also why `#{client_control_mode}` is empty.
 */
export function renderFormat(
  fmt: string,
  vars: Record<string, string>,
): string {
  return fmt.replace(/#\{([a-z_]+)\}/g, (_m, name: string) => vars[name] ?? "");
}
