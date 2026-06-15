/**
 * Pure dispatcher for the agent-teams `tmux` shim (SP-tgnb5o).
 *
 * Claude Code's experimental agent-teams feature (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)
 * drives a display backend by shelling out to `tmux`. Where neither tmux nor
 * iTerm2 is available (plain VS Code), we put a fake `tmux` on PATH that
 * forwards each invocation to this dispatcher, which maps the narrow subset
 * Claude actually calls onto a pane registry (PTYs rendered as VS Code
 * terminals — supplied by the host as a `PaneFactory`).
 *
 * This module is deliberately free of `vscode` and `node-pty` imports so the
 * command-surface behaviour (AC#2, AC#3, and the log-and-no-op contract) is
 * unit-testable headlessly; the real PTY/pane plumbing is injected.
 *
 * The reverse-engineered command surface and its drift policy live in
 * docs/claude-code-internals.md (SL-5). Anything not recognised here is
 * **logged and no-op'd** (exit 0) rather than crashed — Constraint in the Spec.
 */

/** A live teammate pane: a PTY whose bytes render in a VS Code terminal. */
export interface Pane {
  readonly id: string; // tmux `#{pane_id}`, e.g. "%1"
  write(data: string): void;
  kill(): void;
}

/** What `new-session` / `split-window` need to spawn a teammate. */
export interface TeammateSpec {
  sessionName: string;
  paneId: string;
  command: string;
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
  /** Text the real `tmux` would print on stdout (no trailing newline added). */
  stdout: string;
  /** Process exit code the shim should return. */
  exitCode: number;
}

/** Parsed shape of a `tmux <subcommand> ...flags [-- cmd args]` invocation. */
export interface ParsedTmux {
  subcommand: string;
  /** option → value (last wins); valueless flags map to "". */
  opts: Record<string, string>;
  /** everything after `--` (the teammate command + its args). */
  rest: string[];
}

// Flags in the agent-teams subset that take a value argument.
const VALUE_FLAGS = new Set(["-t", "-s", "-F", "-c", "-x", "-y", "-n"]);

/**
 * Parse a `tmux` argv (without the leading "tmux"). Only models what the
 * agent-teams subset uses: the subcommand, the value/boolean flags above, and
 * the post-`--` teammate command. Unknown flags are tolerated (kept as boolean
 * opts) so an upstream addition degrades to log-and-no-op rather than a crash.
 */
export function parseTmuxArgs(argv: string[]): ParsedTmux {
  const subcommand = argv[0] ?? "";
  const opts: Record<string, string> = {};
  const rest: string[] = [];
  let i = 1;
  for (; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith("-")) {
      if (VALUE_FLAGS.has(tok)) {
        opts[tok] = argv[++i] ?? "";
      } else {
        opts[tok] = "";
      }
    } else {
      // A bare positional (e.g. the literal text for `send-keys` without `--`).
      rest.push(tok);
    }
  }
  return { subcommand, opts, rest };
}

let paneSeq = 0;
/** Mint a fresh tmux-style pane id (`%0`, `%1`, …). */
function nextPaneId(): string {
  return `%${paneSeq++}`;
}

/** For tests: reset the pane-id counter so ids are deterministic. */
export function __resetPaneSeqForTests(): void {
  paneSeq = 0;
}

/**
 * The registry + command handler. One instance per Extension Host; the IPC
 * server feeds it parsed invocations and returns the {stdout, exitCode}.
 */
export class TmuxRegistry {
  // sessionName → (paneId → Pane)
  private readonly sessions = new Map<string, Map<string, Pane>>();

  constructor(
    private readonly factory: PaneFactory,
    /** Sink for unrecognised invocations (drift signal). */
    private readonly log: (msg: string) => void = () => {},
  ) {}

  dispatch(argv: string[]): DispatchResult {
    const { subcommand, opts, rest } = parseTmuxArgs(argv);
    switch (subcommand) {
      case "new-session":
      case "split-window":
        return this.openPane(opts, rest);
      case "send-keys":
        return this.sendKeys(opts, rest);
      case "kill-session":
        return this.killSession(opts);
      case "has-session":
        return this.hasSession(opts);
      case "list-panes":
        return this.listPanes(opts);
      case "display-message":
        return this.displayMessage(opts, rest);
      case "new":
        return this.openPane(opts, rest);
      // Init probes the pane backend runs before it commits to tmux — if these
      // don't answer plausibly, Claude Code silently falls back to the
      // in-process backend (SP-tgnb5o spike finding). `-V` is the availability
      // gate (exit 0 = tmux present); show/show-options feed config detection.
      case "-V":
        return { stdout: "tmux 3.4\n", exitCode: 0 };
      case "show":
        return this.showOption(opts, rest);
      case "show-options":
        return this.showOptionsCmd(rest);
      // Focus/attach/clipboard — meaningful in a real terminal multiplexer, but
      // our panes are VS Code terminals, so accept them as successful no-ops.
      case "switch-client":
      case "attach-session":
      case "load-buffer":
        return ok();
      // Cosmetic / layout — accepted as no-ops so Claude's calls succeed.
      case "select-pane":
      case "set-option":
      case "set-hook":
      case "resize-pane":
      case "rename-window":
        return ok();
      default:
        // Drift: an unrecognised subcommand. Never crash — log and succeed.
        this.log(`unrecognised tmux subcommand: ${argv.join(" ")}`);
        return ok();
    }
  }

  private sessionNameFor(opts: Record<string, string>): string {
    // `-t target` may be "name", "name:win", or "name:win.pane"; the session
    // is the part before the first ':'. `-s` names a new session.
    const target = opts["-s"] ?? opts["-t"] ?? "default";
    return target.split(":")[0];
  }

  private openPane(
    opts: Record<string, string>,
    rest: string[],
  ): DispatchResult {
    const sessionName = this.sessionNameFor(opts);
    const paneId = nextPaneId();
    const [command, ...args] = rest;
    if (!command) {
      // No teammate command to run — log; still report a pane id so Claude's
      // `-P -F '#{pane_id}'` read doesn't break.
      this.log(`open pane with no command: ${JSON.stringify(opts)}`);
    } else {
      const pane = this.factory.spawn({
        sessionName,
        paneId,
        command,
        args,
        cwd: opts["-c"],
      });
      let panes = this.sessions.get(sessionName);
      if (!panes) {
        panes = new Map();
        this.sessions.set(sessionName, panes);
      }
      panes.set(paneId, pane);
    }
    // Claude reads the new pane id via `-P -F '#{pane_id}'`. Honour an `-F`
    // format containing the token; otherwise print the bare id (tmux prints
    // nothing without -P, but Claude always passes it, and printing the id is
    // harmless and useful).
    const fmt = opts["-F"];
    const stdout = fmt ? renderFormat(fmt, { pane_id: paneId }) : paneId;
    return { stdout, exitCode: 0 };
  }

  private sendKeys(
    opts: Record<string, string>,
    rest: string[],
  ): DispatchResult {
    const target = opts["-t"];
    const pane = this.paneByTarget(target);
    if (!pane) {
      this.log(`send-keys to unknown pane: ${target ?? "(none)"}`);
      return ok();
    }
    if ("-l" in opts) {
      // Literal bytes: everything in `rest` is the text to write verbatim.
      pane.write(rest.join(" "));
    } else {
      // Key names. Agent-teams only uses "Enter" (carriage return). Any other
      // key-name is logged so drift surfaces, then ignored.
      for (const key of rest) {
        if (key === "Enter" || key === "C-m") {
          pane.write("\r");
        } else {
          this.log(`send-keys unmapped key-name: ${key}`);
        }
      }
    }
    return ok();
  }

  private killSession(opts: Record<string, string>): DispatchResult {
    const name = this.sessionNameFor(opts);
    const panes = this.sessions.get(name);
    if (panes) {
      for (const pane of panes.values()) pane.kill();
      this.sessions.delete(name);
    }
    return ok();
  }

  private hasSession(opts: Record<string, string>): DispatchResult {
    const name = this.sessionNameFor(opts);
    // tmux: exit 0 when the session exists, 1 otherwise.
    return { stdout: "", exitCode: this.sessions.has(name) ? 0 : 1 };
  }

  private listPanes(opts: Record<string, string>): DispatchResult {
    const name = this.sessionNameFor(opts);
    const panes = this.sessions.get(name);
    const ids = panes ? [...panes.keys()] : [];
    const fmt = opts["-F"];
    const lines = ids.map((id) =>
      fmt ? renderFormat(fmt, { pane_id: id }) : id,
    );
    return { stdout: lines.join("\n"), exitCode: 0 };
  }

  private displayMessage(
    opts: Record<string, string>,
    rest: string[],
  ): DispatchResult {
    // The requested format is the positional after `-p` (NOT `-F`):
    // `display-message -p "#{pane_id}"`. Claude uses this both to stay off the
    // iTerm2 `-CC` path (`#{client_control_mode}` must be EMPTY) and — crucially
    // — to locate its OWN current pane/window ("Could not determine current
    // tmux pane/window" if these are empty). We run "inside tmux" per the
    // synthetic $TMUX, so answer a stable fabricated current context.
    const fmt = opts["-F"] ?? rest[rest.length - 1] ?? "";
    const stdout = renderFormat(fmt, {
      client_control_mode: "", // keep empty: we are not an iTerm2 -CC client
      client_termtype: "tmux-256color",
      pane_id: "%0",
      pane_index: "0",
      window_id: "@0",
      window_index: "0",
      window_name: "claude",
      session_name: "default",
      session_id: "$0",
    });
    return { stdout, exitCode: 0 };
  }

  /**
   * `tmux show [-Av|-gv] <name>` — option queries the pane backend uses to
   * detect tmux config (mouse mode, focus-events). We don't enable those, so
   * answer the value as "off" (`-v` prints the bare value; otherwise
   * `name value`). Claude treats a non-"on" answer as "no conflict".
   */
  private showOption(
    opts: Record<string, string>,
    rest: string[],
  ): DispatchResult {
    const name = rest[0] ?? "";
    const valueOnly = Object.keys(opts).some((k) => k.includes("v"));
    const value = "off";
    return {
      stdout: valueOnly ? `${value}\n` : `${name} ${value}\n`,
      exitCode: 0,
    };
  }

  /**
   * `tmux show-options -g <name>` — Claude reads `prefix` to detect a binding
   * conflict (it matches /prefix\s+(\S+)/). Report the tmux default `C-b`.
   */
  private showOptionsCmd(rest: string[]): DispatchResult {
    const name = rest[rest.length - 1] ?? "";
    if (name === "prefix") return { stdout: "prefix C-b\n", exitCode: 0 };
    return { stdout: name ? `${name}\n` : "", exitCode: 0 };
  }

  private paneByTarget(target: string | undefined): Pane | undefined {
    if (!target) return undefined;
    // target may be "name:win.%paneId" or just "%paneId". Search by pane id.
    const paneId = target.includes("%") ? "%" + target.split("%")[1] : target;
    for (const panes of this.sessions.values()) {
      const pane = panes.get(paneId);
      if (pane) return pane;
    }
    return undefined;
  }

  /** Test/diagnostic helper: live pane count across all sessions. */
  paneCount(): number {
    let n = 0;
    for (const panes of this.sessions.values()) n += panes.size;
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
