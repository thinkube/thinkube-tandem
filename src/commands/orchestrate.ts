/**
 * `/orchestrate` command (SP-tgs8nz_SL-1): dispatch the next Ready slice of a chosen Spec
 * via `OrchestratorService`. Thin vscode glue — resolves the active board repo, the spec,
 * and the worktree/board config, then calls `dispatchNext` and streams the worker's
 * JSON-log to an output channel. The dispatch logic + parsing are the unit-tested core;
 * the live worker outcome is the human's verdict.
 */
import * as vscode from "vscode";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { WorktreeService } from "../services/WorktreeService";
import { OrchestratorService } from "../services/OrchestratorService";
import * as fs from "node:fs";
import {
  extractDiagnosis,
  buildAttendPrompt,
  StreamJsonBuffer,
  summarizeEvent,
} from "../services/orchestratorCore";
import { sessionLogPath } from "../services/orchestratorSessions";
import type { OwnershipArbiter } from "../services/OwnershipArbiter";
import type { LauncherService } from "../services/LauncherService";
import type { SpecsProvider } from "../views/boards/SpecsProvider";

export interface OrchestrateDeps {
  specsProvider: SpecsProvider;
  /** The arbiter is built async at activation — a getter so we read it when invoked. */
  getArbiter: () => OwnershipArbiter | undefined;
  /** Opens primed sessions for `/attend` (reuses the cwd-wrapper launcher). */
  launcher: LauncherService;
  /** Injectable for tests; defaults to real instances. */
  worktrees?: WorktreeService;
  output?: vscode.OutputChannel;
}

export function registerOrchestrateCommands(
  context: vscode.ExtensionContext,
  deps: OrchestrateDeps,
): void {
  const worktrees = deps.worktrees ?? new WorktreeService();
  const output =
    deps.output ?? vscode.window.createOutputChannel("Thinkube Orchestrator");
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("thinkube.orchestrate", async () => {
      const repo = deps.specsProvider.repoEntry;
      if (!repo || !repo.enabled) {
        vscode.window.showInformationMessage(
          "Select an enabled thinking space to orchestrate.",
        );
        return;
      }
      const arbiter = deps.getArbiter();
      if (!arbiter) {
        vscode.window.showWarningMessage(
          "Orchestrator not ready — the ownership arbiter is still activating. Try again in a moment.",
        );
        return;
      }
      try {
        const store = new ThinkubeStore(repo.path, repo.boardDir);
        const specs = (await store.listSpecDirs())
          .map((d) => /SP-([^/]+)/.exec(d)?.[1])
          .filter((id): id is string => !!id);
        if (specs.length === 0) {
          vscode.window.showInformationMessage("No Specs on this board yet.");
          return;
        }
        const specId =
          specs.length === 1
            ? specs[0]
            : await vscode.window.showQuickPick(
                specs.map((id) => `SP-${id}`),
                { placeHolder: "Orchestrate which Spec's next Ready slice?" },
              );
        if (!specId) return;
        const spec = specId.replace(/^SP-/, "");

        const canonical =
          (await worktrees.canonicalRepo(repo.path)) ?? repo.path;
        const baseDir =
          vscode.workspace
            .getConfiguration("thinkube")
            .get<string>("worktree.baseDir")
            ?.trim() || undefined;
        const boardRoot =
          vscode.workspace
            .getConfiguration("thinkube.boards")
            .get<string>("root")
            ?.trim() || undefined;

        const orchestrator = new OrchestratorService({
          worktrees,
          arbiter,
          store,
          output,
          canonicalRepo: canonical,
          boardRoot,
          baseDir,
        });
        output.show(true);
        const cap =
          vscode.workspace
            .getConfiguration("thinkube.orchestrator")
            .get<number>("maxConcurrent") ?? 4;
        const r = await orchestrator.dispatchSpec(spec, cap);
        if (!r.ok) {
          vscode.window.showErrorMessage(
            `SP-${spec}: malformed DAG — ${r.reason?.split("\n")[0] ?? "rejected"}`,
          );
        } else if (r.dispatched === 0) {
          vscode.window.showInformationMessage(
            `SP-${spec}: nothing to dispatch — no Ready + deps-satisfied unit.`,
          );
        } else {
          vscode.window.showInformationMessage(
            `SP-${spec}: dispatched ${r.dispatched} unit(s), ${r.advanced.length} slice(s) Done` +
              (r.needsInput.length ? `, ${r.needsInput.length} need input` : "") +
              (r.attention.length ? `, ${r.attention.length} need attention` : "") +
              (r.committed ? " — committed ✓" : ""),
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Orchestrate failed: ${(err as Error).message}`,
        );
      }
    }),
    vscode.commands.registerCommand(
      "thinkube.floatOutSession",
      (handle?: string) => floatOutSession(context, handle),
    ),
    vscode.commands.registerCommand(
      "thinkube.attend",
      async (handle?: string) => {
        const repo = deps.specsProvider.repoEntry;
        if (!repo || !repo.enabled) {
          vscode.window.showInformationMessage(
            "Select an enabled thinking space to attend a slice.",
          );
          return;
        }
        try {
          const store = new ThinkubeStore(repo.path, repo.boardDir);
          const h = handle ?? (await pickAttentionSlice(store));
          if (!h) return;
          const m = /^SP-(.+)_SL-(\d+)$/.exec(h);
          if (!m) {
            vscode.window.showErrorMessage(`Bad slice handle "${h}".`);
            return;
          }
          const specId = m[1];
          const rel = store.pathForSlice(specId, Number(m[2]));
          const body = (await store.getFile(rel))?.body ?? "";
          const diagnosis = extractDiagnosis(body);

          const canonical =
            (await worktrees.canonicalRepo(repo.path)) ?? repo.path;
          const baseDir =
            vscode.workspace
              .getConfiguration("thinkube")
              .get<string>("worktree.baseDir")
              ?.trim() || undefined;
          const boardRoot =
            vscode.workspace
              .getConfiguration("thinkube.boards")
              .get<string>("root")
              ?.trim() || undefined;
          // Root the primed session in the slice's worktree (reuses the launcher / cwd-wrapper).
          const worktreePath = await worktrees.create(
            canonical,
            specId,
            baseDir,
            boardRoot,
          );
          await deps.launcher.openHere(
            vscode.Uri.file(worktreePath),
            buildAttendPrompt(h, diagnosis),
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Attend failed: ${(err as Error).message}`,
          );
        }
      },
    ),
  );
}

/** Find requires-attention slices on the board and quick-pick one (or the only one). */
async function pickAttentionSlice(
  store: ThinkubeStore,
): Promise<string | undefined> {
  const handles: string[] = [];
  for (const dir of await store.listSpecDirs()) {
    const specId = /SP-([^/]+)/.exec(dir)?.[1];
    if (!specId) continue;
    for (const rel of await store.listSlices(specId)) {
      const fm = (await store.getFile(rel))?.frontmatter;
      if ((fm?.status ?? "") === "requires-attention") {
        const num = /SL-(\d+)\.md$/.exec(rel)?.[1];
        if (num) handles.push(store.sliceHandle(specId, Number(num)));
      }
    }
  }
  if (handles.length === 0) {
    vscode.window.showInformationMessage(
      "No requires-attention slices to attend.",
    );
    return undefined;
  }
  if (handles.length === 1) return handles[0];
  return vscode.window.showQuickPick(handles, {
    placeHolder: "Attend which requires-attention slice?",
  });
}

/**
 * Float a running (or finished) session into a webview panel beside the editor (SP-tgs8nz
 * AC7) — the user can "Move into New Window" onto a second monitor; on code-server, where the
 * aux-window route is unreliable, this beside-panel IS the dedicated-window fallback. It
 * renders the session's persisted `.jsonl` and live-tails it while the worker streams.
 */
function floatOutSession(
  context: vscode.ExtensionContext,
  handle?: string,
): void {
  const title = handle ? `Session · ${handle}` : "Orchestrator Session";
  const panel = vscode.window.createWebviewPanel(
    "thinkubeSession",
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { retainContextWhenHidden: true },
  );
  const logPath = handle ? sessionLogPath(handle) : undefined;

  const render = () => {
    const lines: string[] = [];
    if (logPath) {
      try {
        const buf = new StreamJsonBuffer();
        for (const evt of buf.push(fs.readFileSync(logPath, "utf8"))) {
          const s = summarizeEvent(evt);
          if (s) lines.push(s);
        }
      } catch {
        /* file not ready yet */
      }
    }
    const body = lines.length
      ? lines.map(esc).join("\n")
      : logPath
        ? "Waiting for session output…"
        : "No session log for this slice yet — run it via “Orchestrate Next Slice”.";
    panel.webview.html = sessionHtml(esc(title), body);
  };

  render();
  let watcher: fs.FSWatcher | undefined;
  if (logPath) {
    try {
      watcher = fs.watch(logPath, () => render());
    } catch {
      /* best-effort — the panel still shows what's there */
    }
  }
  panel.onDidDispose(() => watcher?.close());
  context.subscriptions.push(panel);
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

function sessionHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:13px var(--vscode-editor-font-family,monospace);padding:8px;color:var(--vscode-foreground)}h1{font-size:13px;opacity:.7}#log{white-space:pre-wrap}.hint{opacity:.5}</style></head><body><h1>${title}</h1><div id="log">${body}</div><p class="hint">Use the editor's “Move into New Window” to place this on a second monitor.</p></body></html>`;
}
