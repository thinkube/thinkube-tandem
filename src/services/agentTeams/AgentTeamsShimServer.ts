/**
 * AgentTeamsShimServer — the Extension-Host half of the fake-`tmux` backend
 * for Claude Code agent teams (SP-tgnb5o_SL-1, spike).
 *
 * Each `tmux …` invocation Claude Code makes is a short-lived process, but the
 * pane/PTY state must outlive it and live where the VS Code terminals are — in
 * the Extension Host. So this service runs a tiny IPC server on a unix socket
 * (named pipe on Windows); the on-PATH `tmux` shim (wrapper/tmux-shim.js)
 * connects, sends its argv as one JSON line, and gets back `{stdout, exitCode}`.
 * The socket path is published to child processes via THINKUBE_TMUX_SHIM_SOCK,
 * exactly as the cwd-wrapper publishes CLAUDE_CWD_PROXY_DIR (see LauncherService).
 *
 * The command surface itself lives in the pure `TmuxRegistry` (tmuxDispatcher.ts,
 * unit-tested headlessly). This file supplies the real `PaneFactory`: a node-pty
 * teammate process rendered through a VS Code `Pseudoterminal`. node-pty is a
 * native module loaded lazily so a missing/unbuilt binary degrades to a logged
 * no-op pane rather than breaking activation.
 *
 * Interactive behaviour (a real team forming, both teammates reaching idle —
 * AC#1) is verified at the acceptance gate per the Spec's recorded TEP-tgnvkw
 * exception; what's gated headlessly is the dispatcher + this wiring compiling.
 */
import * as vscode from "vscode";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  TmuxRegistry,
  type Pane,
  type PaneFactory,
  type TeammateSpec,
} from "./tmuxDispatcher";
import {
  decideTmuxTakeover,
  findExistingTmuxDir,
  isExecutable,
  prependToPath,
  splitPath,
} from "./tmuxShimInstall";
import { createTmuxShimServer } from "./ipcServer";

const COMPETING_TMUX_TOAST_KEY = "thinkube.tmuxShim.competingToastShown";

export const SHIM_SOCK_ENV = "THINKUBE_TMUX_SHIM_SOCK";

// Minimal shape of the bits of node-pty we use — declared locally so `tsc`
// needs no compile-time dependency on the native module (it's require()'d lazily).
interface PtyProcess {
  write(data: string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  kill(): void;
}
interface NodePty {
  spawn(
    file: string,
    args: string[],
    opts: {
      name: string;
      cols: number;
      rows: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    },
  ): PtyProcess;
}

export class AgentTeamsShimServer implements vscode.Disposable {
  private server: net.Server | undefined;
  private socketPath: string | undefined;
  private nodePty: NodePty | null | undefined; // undefined=untried, null=unavailable

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** Start the IPC server and publish its socket path to child processes. */
  async activate(): Promise<void> {
    // environmentVariableCollection is PERSISTED by VS Code across reloads, so
    // always clear stale entries (PATH prepend, $TMUX, flag) from a prior run
    // first — otherwise disabling the feature would leave the shim shadowing
    // real tmux on terminal PATH.
    this.context.environmentVariableCollection.clear();

    // Opt-out switch: when disabled, do nothing — no flag, no shim, no server.
    const enabled = vscode.workspace
      .getConfiguration("thinkube")
      .get<boolean>("agentTeams.enableExperimental", true);
    if (!enabled) {
      this.output.appendLine(
        "[tmux-shim] agent teams disabled (thinkube.agentTeams.enableExperimental=false)",
      );
      return;
    }

    // Turn on Claude Code's experimental agent teams for sessions launched from
    // this host (inherited by the `claude` child, like THINKUBE_TMUX_SHIM_SOCK).
    // Don't override an explicit value the user already set.
    if (!process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) {
      process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
    }

    const stateDir = this.context.globalStorageUri.fsPath;
    await fs.promises.mkdir(stateDir, { recursive: true });
    this.socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\thinkube-tmux-shim`
        : path.join(stateDir, "tmux-shim.sock");

    // Clear a stale socket file from a previous host (POSIX only).
    if (process.platform !== "win32") {
      await fs.promises.rm(this.socketPath, { force: true }).catch(() => {});
    }

    const registry = new TmuxRegistry(this.makeFactory(), (m) =>
      this.output.appendLine(`[tmux-shim] ${m}`),
    );

    this.server = createTmuxShimServer(registry, (m) =>
      this.output.appendLine(`[tmux-shim] ${m}`),
    );

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath!, () => {
        this.server!.removeListener("error", reject);
        resolve();
      });
    });

    process.env[SHIM_SOCK_ENV] = this.socketPath;
    this.output.appendLine(
      `[tmux-shim] listening on ${this.socketPath} (${SHIM_SOCK_ENV})`,
    );

    // Make Claude Code route teammates to the tmux (our shim) backend. It picks
    // tmux when teammateMode is "tmux" OR `auto` + insideTmux (`!!process.env.TMUX`);
    // otherwise it uses the in-process backend (spike finding — see the Spec). We
    // don't run inside a real tmux, so present a synthetic $TMUX (path,pid,session)
    // that's parseable and truthy. Our shim ignores $TMUX (it dials
    // THINKUBE_TMUX_SHIM_SOCK), so the value just needs to flip the detector.
    // Don't override a genuine tmux the user is actually inside.
    if (!process.env.TMUX) {
      process.env.TMUX = `${this.socketPath},0,0`;
      process.env.TMUX_PANE = "%0";
    }

    await this.installShimOnPath();

    // process.env (above) reaches children the *extension* spawns (claude-vscode
    // → claude). To also cover `claude` run from an integrated VS Code terminal,
    // mirror the agent-teams env into the window's terminal environment.
    const shimDir = this.context.asAbsolutePath(path.join("dist", "wrapper"));
    const envColl = this.context.environmentVariableCollection;
    envColl.replace("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1");
    envColl.replace(SHIM_SOCK_ENV, this.socketPath);
    envColl.replace("TMUX", `${this.socketPath},0,0`);
    envColl.replace("TMUX_PANE", "%0");
    envColl.prepend("PATH", shimDir + path.delimiter);
  }

  /**
   * Put our `tmux` shim dir on PATH ahead of any system tmux so the `claude`
   * child (spawned by claude-vscode) resolves `tmux` to us (SP-tgnb5o_SL-2,
   * AC#5). Takeover policy mirrors LauncherService: free/ours → install; an
   * unknown third-party tmux → one-time confirmation, never silent clobber.
   */
  private async installShimOnPath(): Promise<void> {
    const shimDir = this.context.asAbsolutePath(path.join("dist", "wrapper"));
    const pathEntries = splitPath(process.env.PATH);
    const existingTmuxDir = findExistingTmuxDir(
      pathEntries,
      shimDir,
      isExecutable,
    );
    const decision = decideTmuxTakeover({
      pathEntries,
      shimDir,
      existingTmuxDir,
    });
    switch (decision) {
      case "already-installed":
        return;
      case "install":
        process.env.PATH = prependToPath(process.env.PATH, shimDir);
        this.output.appendLine(
          `[tmux-shim] installed on PATH ahead of ${existingTmuxDir ?? "(no system tmux)"}`,
        );
        return;
      case "needs-confirmation":
        await this.confirmTakeover(shimDir, existingTmuxDir as string);
        return;
      case "skip":
        return;
    }
  }

  private async confirmTakeover(
    shimDir: string,
    competingDir: string,
  ): Promise<void> {
    if (this.context.globalState.get<boolean>(COMPETING_TMUX_TOAST_KEY)) return;
    await this.context.globalState.update(COMPETING_TMUX_TOAST_KEY, true);
    const choice = await vscode.window.showWarningMessage(
      `Thinkube agent teams: a tmux is already on PATH ("${competingDir}"). ` +
        `Use Thinkube's tmux shim so Claude Code agent teams render in VS Code panes?`,
      "Use Thinkube shim",
      "Keep existing",
    );
    if (choice === "Use Thinkube shim") {
      process.env.PATH = prependToPath(process.env.PATH, shimDir);
      this.output.appendLine(
        `[tmux-shim] installed on PATH (user-confirmed over ${competingDir})`,
      );
    }
  }

  /** Socket path child processes connect to (for the shim CLI / tests). */
  get socket(): string | undefined {
    return this.socketPath;
  }

  /** Build the real PaneFactory: node-pty teammate → VS Code terminal pane. */
  private makeFactory(): PaneFactory {
    return {
      spawn: (spec: TeammateSpec): Pane => this.spawnPane(spec),
    };
  }

  private loadNodePty(): NodePty | null {
    if (this.nodePty !== undefined) return this.nodePty;
    try {
      // Lazy native require — only needed when a team actually forms.
      this.nodePty = require("node-pty") as NodePty;
    } catch (err) {
      this.output.appendLine(
        `[tmux-shim] node-pty unavailable (${(err as Error).message}); ` +
          `panes will be inert until it's installed/rebuilt for this runtime.`,
      );
      this.nodePty = null;
    }
    return this.nodePty;
  }

  private spawnPane(spec: TeammateSpec): Pane {
    const pty = this.loadNodePty();
    if (!pty) {
      // Degraded: no PTY backend. Return an inert pane so the dispatcher and
      // Claude keep working; the drift/conformance test (SL-4) and the
      // interactive acceptance check surface the real-world gap.
      return { id: spec.paneId, write: () => {}, kill: () => {} };
    }

    const proc = pty.spawn(spec.command, spec.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: spec.cwd,
      env: { ...process.env, ...(spec.env ?? {}) },
    });

    // Render the teammate's PTY bytes straight through a VS Code terminal pane
    // (no scrollback/vt buffer — out of scope per the Spec). handleInput routes
    // the user's keystrokes back to this teammate (AC#4).
    //
    // A Pseudoterminal only subscribes to `onDidWrite` once VS Code calls
    // `open()`, but node-pty starts emitting the moment it spawns — so the
    // teammate's first output (banner, prompt) is emitted before anyone is
    // listening and is silently dropped (observed live: an empty pane with just
    // a cursor). Buffer PTY data until `open()`, then flush and go live.
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();
    let opened = false;
    const backlog: string[] = [];
    const emit = (data: string) => {
      if (opened) {
        writeEmitter.fire(data);
      } else {
        backlog.push(data);
      }
    };
    const term = vscode.window.createTerminal({
      name: `team:${spec.sessionName} ${spec.paneId}`,
      pty: {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => {
          opened = true;
          for (const d of backlog) writeEmitter.fire(d);
          backlog.length = 0;
        },
        close: () => proc.kill(),
        handleInput: (data: string) => proc.write(data),
      },
    });
    proc.onData((d) => emit(d));
    proc.onExit(({ exitCode }) => closeEmitter.fire(exitCode));
    term.show(/* preserveFocus */ true);

    return {
      id: spec.paneId,
      write: (data: string) => proc.write(data),
      kill: () => {
        proc.kill();
        term.dispose();
      },
    };
  }

  dispose(): void {
    this.server?.close();
    if (this.socketPath && process.platform !== "win32") {
      fs.rm(this.socketPath, { force: true }, () => {});
    }
    if (process.env[SHIM_SOCK_ENV] === this.socketPath) {
      delete process.env[SHIM_SOCK_ENV];
    }
  }
}
